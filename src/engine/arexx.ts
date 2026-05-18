/**
 * arexx.ts — ModeCat ARexx interpreter.
 *
 * Implements the ARexx dialect of REXX (AmigaOS 2.x style) with an
 * ADDRESS 'MODECAT' command port for live song-model manipulation.
 *
 * Language subset:
 *   Variables (string-typed; uninitialised = uppercased name, REXX rule §5.1)
 *   Arithmetic:  + - * / // %   (// = integer division, % = modulo)
 *   String:      || (explicit concat), space-concat (REXX §5.3.7 abuttal)
 *   Comparison:  = == \= \== < > <= >= (= is trimmed case-insensitive)
 *   Logical:     & | \ (NOT)  — \= same as ~= , both accepted
 *   DO i=N TO M [BY S] ... END
 *   DO WHILE expr ... END
 *   DO FOREVER ... END
 *   IF expr THEN stmt-or-block [ELSE stmt-or-block]
 *   SAY expr
 *   ADDRESS 'env'           — switch default command port
 *   ADDRESS 'env' 'cmd'     — send one command to env, keep current default
 *   Bare expression stmt    — evaluated and sent to current address
 *   LEAVE / ITERATE / EXIT [expr]
 *   PARSE VAR name w1 w2 … — split variable value into words
 *   PARSE VALUE expr WITH w1 w2 …
 *   Block comments  (slash-star ... star-slash)
 *   Trailing comma continuation
 *   RESULT / RC special variables set by command dispatcher
 *
 * ModeCat command port: see AREXX_COMMANDS.md
 */

import { useStore } from '../state/store';
import { MAX_INSTRUMENTS } from '../state/types';

// ═══════════════════════════════════════════════════════════════════════════
//  TOKENISER
// ═══════════════════════════════════════════════════════════════════════════

type TT = 'word' | 'str' | 'num' | 'op' | 'lp' | 'rp' | 'nl' | 'eof';
interface Tok { t: TT; v: string; ln: number; }

const KEYWORDS = new Set([
  'DO','END','WHILE','FOREVER','TO','BY',
  'IF','THEN','ELSE',
  'SAY','ADDRESS','LEAVE','ITERATE','EXIT',
  'PARSE','VAR','VALUE','WITH','PULL',
  'RETURN','SELECT','WHEN','OTHERWISE',
  'NOP',
]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0, ln = 1;
  const at   = (n = 0): string => src[i + n] ?? '';
  const adv  = (): string => { const c = src[i++] ?? ''; if (c === '\n') ln++; return c; };
  const emit = (t: TT, v: string) => out.push({ t, v, ln });

  while (i < src.length) {
    const c = at();

    // Spaces/tabs/CR — skip (NOT newlines)
    if (c === ' ' || c === '\t' || c === '\r') { adv(); continue; }

    // Block comment  /* ... */
    if (c === '/' && at(1) === '*') {
      i += 2;
      while (i < src.length && !(at() === '*' && at(1) === '/')) adv();
      i += 2;
      continue;
    }

    // Line continuation: trailing comma → next line joins
    if (c === ',') {
      adv();
      while (i < src.length && at() !== '\n') adv();
      if (at() === '\n') adv();
      continue;
    }

    // Newline / semicolon = statement boundary
    if (c === '\n') { adv(); emit('nl', '\n'); continue; }
    if (c === ';')  { adv(); emit('nl', ';');  continue; }

    // String literals — single or double quotes, doubled-quote escape
    if (c === "'" || c === '"') {
      const q = adv(); let s = '';
      while (i < src.length) {
        const x = adv();
        if (x === q) {
          if (at() === q) { s += q; adv(); }
          else break;
        } else s += x;
      }
      emit('str', s);
      continue;
    }

    // Numbers (positive; negation handled in parser)
    if (c >= '0' && c <= '9') {
      let n = '';
      while (i < src.length && ((at() >= '0' && at() <= '9') || at() === '.')) n += adv();
      emit('num', n);
      continue;
    }

    // Words / keywords
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      let w = '';
      while (i < src.length) {
        const x = at();
        if ((x >= 'A' && x <= 'Z') || (x >= 'a' && x <= 'z') ||
            (x >= '0' && x <= '9') || x === '_' || x === '.') w += adv();
        else break;
      }
      emit('word', w);
      continue;
    }

    // Parens
    if (c === '(') { adv(); emit('lp', '('); continue; }
    if (c === ')') { adv(); emit('rp', ')'); continue; }

    // Operators — longest match first
    const t3 = at() + at(1) + at(2);
    const t2 = at() + at(1);
    if (t3 === '\\==' || t3 === '~==') { i += 3; emit('op', t3); continue; }
    if (t2 === '\\=' || t2 === '~=' || t2 === '<=' || t2 === '>=' ||
        t2 === '==' || t2 === '||'  || t2 === '//' || t2 === '\\<' ||
        t2 === '\\>' || t2 === '~<' || t2 === '~>') {
      i += 2; emit('op', t2); continue;
    }
    if ('=<>+-*/%|&'.includes(c) || c === '\\' || c === '~') {
      emit('op', adv()); continue;
    }

    adv(); // skip unknown character
  }

  emit('eof', '');
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  AST TYPES
// ═══════════════════════════════════════════════════════════════════════════

type Expr =
  | { k: 'lit';    v: string }
  | { k: 'var';    name: string }
  | { k: 'binop';  op: string; l: Expr; r: Expr }
  | { k: 'unop';   op: string; e: Expr }
  | { k: 'concat'; sep: string; parts: Expr[] };  // sep='' for ||, ' ' for space

type Stmt =
  | { k: 'assign';    name: string; val: Expr }
  | { k: 'say';       val: Expr }
  | { k: 'address';   env: Expr; cmd?: Expr }
  | { k: 'do_range';  var: string; from: Expr; to: Expr; by?: Expr; body: Stmt[] }
  | { k: 'do_while';  cond: Expr; body: Stmt[] }
  | { k: 'do_forever'; body: Stmt[] }
  | { k: 'if';        cond: Expr; then: Stmt[]; else_?: Stmt[] }
  | { k: 'leave' }
  | { k: 'iterate' }
  | { k: 'exit';      val?: Expr }
  | { k: 'parse_var'; src: string; targets: string[] }
  | { k: 'parse_val'; val: Expr;   targets: string[] }
  | { k: 'cmd';       parts: Expr[] }  // evaluated, space-joined, sent to address
  | { k: 'nop' };

// ═══════════════════════════════════════════════════════════════════════════
//  PARSER
// ═══════════════════════════════════════════════════════════════════════════

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private cur(): Tok { return this.toks[this.pos] ?? { t: 'eof', v: '', ln: 0 }; }
  private peek(n = 1): Tok { return this.toks[this.pos + n] ?? { t: 'eof', v: '', ln: 0 }; }
  private adv(): Tok { return this.toks[this.pos++] ?? { t: 'eof', v: '', ln: 0 }; }

  private isKw(kw: string, t?: Tok): boolean {
    const tok = t ?? this.cur();
    return tok.t === 'word' && tok.v.toUpperCase() === kw;
  }

  private skipNl() {
    while (this.cur().t === 'nl') this.adv();
  }

  // Parse the whole program
  parseProgram(): Stmt[] {
    const stmts: Stmt[] = [];
    this.skipNl();
    while (this.cur().t !== 'eof') {
      stmts.push(this.parseStmt());
      // consume trailing newlines
      while (this.cur().t === 'nl') this.adv();
    }
    return stmts;
  }

  // Parse a block of statements until we hit END (or ELSE, or eof)
  parseBlock(stopAt: string[] = ['END']): Stmt[] {
    const stmts: Stmt[] = [];
    this.skipNl();
    while (
      this.cur().t !== 'eof' &&
      !stopAt.some((s) => this.isKw(s))
    ) {
      stmts.push(this.parseStmt());
      while (this.cur().t === 'nl') this.adv();
    }
    return stmts;
  }

  private parseStmt(): Stmt {
    const c = this.cur();

    // NOP
    if (this.isKw('NOP')) { this.adv(); return { k: 'nop' }; }

    // SAY expr
    if (this.isKw('SAY')) {
      this.adv();
      const val = this.parseExprLine();
      return { k: 'say', val };
    }

    // ADDRESS env [cmd]
    if (this.isKw('ADDRESS')) {
      this.adv();
      const env = this.parseExprAtom();
      // If there's more on this line before the newline, it's a one-shot command
      if (this.cur().t !== 'nl' && this.cur().t !== 'eof') {
        const cmd = this.parseExprLine();
        return { k: 'address', env, cmd };
      }
      return { k: 'address', env };
    }

    // DO ...
    if (this.isKw('DO')) {
      this.adv();
      return this.parseDo();
    }

    // IF cond THEN
    if (this.isKw('IF')) {
      this.adv();
      return this.parseIf();
    }

    // LEAVE
    if (this.isKw('LEAVE')) { this.adv(); return { k: 'leave' }; }

    // ITERATE
    if (this.isKw('ITERATE')) { this.adv(); return { k: 'iterate' }; }

    // EXIT [expr]
    if (this.isKw('EXIT')) {
      this.adv();
      if (this.cur().t === 'nl' || this.cur().t === 'eof') return { k: 'exit' };
      return { k: 'exit', val: this.parseExprLine() };
    }

    // RETURN [expr]
    if (this.isKw('RETURN')) {
      this.adv();
      if (this.cur().t === 'nl' || this.cur().t === 'eof') return { k: 'exit' };
      return { k: 'exit', val: this.parseExprLine() };
    }

    // PARSE VAR name w1 w2 … / PARSE VALUE expr WITH w1 w2 …
    if (this.isKw('PARSE')) {
      this.adv();
      return this.parseParse();
    }

    // Assignment:  WORD = expr  (but not == which is comparison)
    if (c.t === 'word' && this.peek().t === 'op' && this.peek().v === '=') {
      const name = this.adv().v;
      this.adv(); // consume =
      const val = this.parseExprLine();
      return { k: 'assign', name: name.toUpperCase(), val };
    }

    // Bare expression / command statement — space-join parts, send to address
    return { k: 'cmd', parts: this.parseCmdParts() };
  }

  // Collect expression parts until newline (for command statements)
  private parseCmdParts(): Expr[] {
    const parts: Expr[] = [];
    while (this.cur().t !== 'nl' && this.cur().t !== 'eof') {
      parts.push(this.parseExprConcat());
    }
    if (parts.length === 0) return [{ k: 'lit', v: '' }];
    return parts;
  }

  // Parse DO clause
  private parseDo(): Stmt {
    this.skipNl();
    // DO WHILE cond
    if (this.isKw('WHILE')) {
      this.adv();
      const cond = this.parseExprLine();
      this.skipNl();
      const body = this.parseBlock();
      if (this.isKw('END')) this.adv();
      return { k: 'do_while', cond, body };
    }
    // DO FOREVER
    if (this.isKw('FOREVER')) {
      this.adv();
      this.skipNl();
      const body = this.parseBlock();
      if (this.isKw('END')) this.adv();
      return { k: 'do_forever', body };
    }
    // DO var = from TO to [BY by]
    if (this.cur().t === 'word' && this.peek().t === 'op' && this.peek().v === '=') {
      const varName = this.adv().v.toUpperCase();
      this.adv(); // =
      const from = this.parseExprUntilKw();
      // must have TO
      if (!this.isKw('TO')) throw new Error(`Line ${this.cur().ln}: expected TO in DO loop`);
      this.adv();
      const to = this.parseExprUntilKw(['BY']);
      let by: Expr | undefined;
      if (this.isKw('BY')) { this.adv(); by = this.parseExprUntilKw(); }
      this.skipNl();
      const body = this.parseBlock();
      if (this.isKw('END')) this.adv();
      return { k: 'do_range', var: varName, from, to, by, body };
    }
    // Bare DO ... END (simple block)
    this.skipNl();
    const body = this.parseBlock();
    if (this.isKw('END')) this.adv();
    return { k: 'do_forever', body }; // treated as execute-once block
  }

  // Parse IF cond THEN stmt [ELSE stmt]
  private parseIf(): Stmt {
    const cond = this.parseExprUntilKw(['THEN']);
    if (!this.isKw('THEN')) throw new Error(`Line ${this.cur().ln}: expected THEN`);
    this.adv();
    this.skipNl();
    const thenBlock = this.parseIfBranch();
    let elseBlock: Stmt[] | undefined;
    this.skipNl();
    if (this.isKw('ELSE')) {
      this.adv();
      this.skipNl();
      elseBlock = this.parseIfBranch();
    }
    return { k: 'if', cond, then: thenBlock, else_: elseBlock };
  }

  private parseIfBranch(): Stmt[] {
    if (this.isKw('DO')) {
      this.adv();
      const body = this.parseBlock();
      if (this.isKw('END')) this.adv();
      return body;
    }
    return [this.parseStmt()];
  }

  // PARSE VAR / PARSE VALUE
  private parseParse(): Stmt {
    if (this.isKw('VAR')) {
      this.adv();
      if (this.cur().t !== 'word') throw new Error(`Line ${this.cur().ln}: PARSE VAR requires variable name`);
      const src = this.adv().v.toUpperCase();
      const targets = this.parseParseTemplate();
      return { k: 'parse_var', src, targets };
    }
    if (this.isKw('VALUE')) {
      this.adv();
      const val = this.parseExprUntilKw(['WITH']);
      if (!this.isKw('WITH')) throw new Error(`Line ${this.cur().ln}: PARSE VALUE requires WITH`);
      this.adv();
      const targets = this.parseParseTemplate();
      return { k: 'parse_val', val, targets };
    }
    // PARSE PULL / PARSE ARG — skip line
    while (this.cur().t !== 'nl' && this.cur().t !== 'eof') this.adv();
    return { k: 'nop' };
  }

  private parseParseTemplate(): string[] {
    const names: string[] = [];
    while (this.cur().t !== 'nl' && this.cur().t !== 'eof') {
      if (this.cur().t === 'word') names.push(this.adv().v.toUpperCase());
      else this.adv();
    }
    return names;
  }

  // Parse expression until we hit a newline
  private parseExprLine(): Expr {
    const e = this.parseExprConcat();
    // Space-concat any remaining atoms on the line
    if (this.cur().t !== 'nl' && this.cur().t !== 'eof') {
      const parts: Expr[] = [e];
      while (this.cur().t !== 'nl' && this.cur().t !== 'eof') {
        parts.push(this.parseExprConcat());
      }
      return { k: 'concat', sep: ' ', parts };
    }
    return e;
  }

  // Parse expression stopping before a keyword from stopKws list
  private parseExprUntilKw(stopKws: string[] = []): Expr {
    const allStops = ['THEN', 'ELSE', 'END', 'WITH', 'TO', 'BY', ...stopKws];
    const parts: Expr[] = [];
    while (this.cur().t !== 'nl' && this.cur().t !== 'eof') {
      if (this.cur().t === 'word' && allStops.some((k) => this.isKw(k))) break;
      parts.push(this.parseExprOr());
    }
    if (parts.length === 0) return { k: 'lit', v: '' };
    if (parts.length === 1) return parts[0]!;
    return { k: 'concat', sep: ' ', parts };
  }

  // ── Expression precedence (low → high) ─────────────────────────────────

  private parseExprConcat(): Expr {
    return this.parseExprOr();
  }

  private parseExprOr(): Expr {
    let l = this.parseExprAnd();
    while (this.cur().t === 'op' && this.cur().v === '|') {
      this.adv();
      const r = this.parseExprAnd();
      l = { k: 'binop', op: '|', l, r };
    }
    return l;
  }

  private parseExprAnd(): Expr {
    let l = this.parseExprNot();
    while (this.cur().t === 'op' && this.cur().v === '&') {
      this.adv();
      const r = this.parseExprNot();
      l = { k: 'binop', op: '&', l, r };
    }
    return l;
  }

  private parseExprNot(): Expr {
    if (this.cur().t === 'op' && (this.cur().v === '\\' || this.cur().v === '~')) {
      this.adv();
      return { k: 'unop', op: '!', e: this.parseExprCompare() };
    }
    return this.parseExprCompare();
  }

  private parseExprCompare(): Expr {
    let l = this.parseExprCat();
    const ops = new Set(['=', '==', '\\=', '~=', '\\==', '~==', '<', '>', '<=', '>=', '\\<', '\\>', '~<', '~>']);
    while (this.cur().t === 'op' && ops.has(this.cur().v)) {
      const op = this.adv().v;
      const r = this.parseExprCat();
      l = { k: 'binop', op, l, r };
    }
    return l;
  }

  private parseExprCat(): Expr {
    let l = this.parseExprAdd();
    while (this.cur().t === 'op' && this.cur().v === '||') {
      this.adv();
      const r = this.parseExprAdd();
      if (l.k === 'concat' && l.sep === '') {
        l = { k: 'concat', sep: '', parts: [...l.parts, r] };
      } else {
        l = { k: 'concat', sep: '', parts: [l, r] };
      }
    }
    return l;
  }

  private parseExprAdd(): Expr {
    let l = this.parseExprMul();
    while (this.cur().t === 'op' && (this.cur().v === '+' || this.cur().v === '-')) {
      const op = this.adv().v;
      const r = this.parseExprMul();
      l = { k: 'binop', op, l, r };
    }
    return l;
  }

  private parseExprMul(): Expr {
    let l = this.parseExprUnary();
    while (this.cur().t === 'op' && (this.cur().v === '*' || this.cur().v === '/' || this.cur().v === '//' || this.cur().v === '%')) {
      const op = this.adv().v;
      const r = this.parseExprUnary();
      l = { k: 'binop', op, l, r };
    }
    return l;
  }

  private parseExprUnary(): Expr {
    if (this.cur().t === 'op' && this.cur().v === '-') {
      this.adv();
      return { k: 'unop', op: '-', e: this.parseExprAtom() };
    }
    if (this.cur().t === 'op' && this.cur().v === '+') {
      this.adv();
      return this.parseExprAtom();
    }
    return this.parseExprAtom();
  }

  private parseExprAtom(): Expr {
    const c = this.cur();
    if (c.t === 'str') { this.adv(); return { k: 'lit', v: c.v }; }
    if (c.t === 'num') { this.adv(); return { k: 'lit', v: c.v }; }
    if (c.t === 'lp') {
      this.adv();
      const e = this.parseExprOr();
      if (this.cur().t === 'rp') this.adv();
      return e;
    }
    if (c.t === 'word') {
      // Don't consume keywords that are structural
      const up = c.v.toUpperCase();
      if (KEYWORDS.has(up) && up !== 'NOP') {
        // Return it as a literal rather than consuming
        return { k: 'lit', v: c.v };
      }
      this.adv();
      // Function call: word(args)
      if (this.cur().t === 'lp') {
        this.adv();
        const args: Expr[] = [];
        while (this.cur().t !== 'rp' && this.cur().t !== 'eof') {
          args.push(this.parseExprOr());
          if (this.cur().t === 'op' && this.cur().v === ',') this.adv(); // comma between args (not statement continuation)
        }
        if (this.cur().t === 'rp') this.adv();
        return { k: 'binop', op: 'call', l: { k: 'lit', v: up }, r: { k: 'concat', sep: '\x00', parts: args } };
      }
      return { k: 'var', name: up };
    }
    // Fallback
    return { k: 'lit', v: '' };
  }
}

function parse(src: string): Stmt[] {
  const toks = tokenize(src);
  return new Parser(toks).parseProgram();
}

// ═══════════════════════════════════════════════════════════════════════════
//  EVALUATOR
// ═══════════════════════════════════════════════════════════════════════════

// Control-flow signals
class LeaveSignal {}
class IterateSignal {}
class ExitSignal { constructor(public val: string) {} }

type Env = Map<string, string>;

interface EvalCtx {
  env: Env;
  address: string;             // current default ADDRESS port
  say: (msg: string) => void;
  dispatch: (env: string, cmd: string) => string;
  iterations: number;
  maxIterations: number;
}

function evalExpr(e: Expr, ctx: EvalCtx): string {
  switch (e.k) {
    case 'lit': return e.v;
    case 'var': {
      const up = e.name.toUpperCase();
      return ctx.env.get(up) ?? up; // uninitialised = own name (REXX §5.1)
    }
    case 'unop': {
      const v = evalExpr(e.e, ctx);
      if (e.op === '-') {
        const n = parseFloat(v);
        if (isNaN(n)) throw new Error(`Not a number: "${v}"`);
        return String(-n);
      }
      if (e.op === '!') { // NOT
        return rxBool(v) ? '0' : '1';
      }
      return v;
    }
    case 'concat': {
      if (e.sep === '\x00') {
        // NUL separator = function args list (internal)
        return e.parts.map((p) => evalExpr(p, ctx)).join('\x00');
      }
      return e.parts.map((p) => evalExpr(p, ctx)).join(e.sep);
    }
    case 'binop': {
      if (e.op === 'call') {
        return callBuiltin(evalExpr(e.l, ctx), evalExpr(e.r, ctx), ctx);
      }
      const lv = evalExpr(e.l, ctx);
      const rv = evalExpr(e.r, ctx);
      return evalBinop(e.op, lv, rv);
    }
  }
}

function evalBinop(op: string, l: string, r: string): string {
  // Arithmetic
  if (['+', '-', '*', '/', '//', '%'].includes(op)) {
    const ln = parseFloat(l), rn = parseFloat(r);
    if (isNaN(ln) || isNaN(rn)) throw new Error(`Not a number: "${l}" or "${r}"`);
    switch (op) {
      case '+': return numStr(ln + rn);
      case '-': return numStr(ln - rn);
      case '*': return numStr(ln * rn);
      case '/': if (rn === 0) throw new Error('Division by zero'); return numStr(ln / rn);
      case '//': if (rn === 0) throw new Error('Division by zero'); return numStr(Math.trunc(ln / rn));
      case '%':  if (rn === 0) throw new Error('Division by zero'); return numStr(ln % rn);
    }
  }
  // Logical
  if (op === '&') return (rxBool(l) && rxBool(r)) ? '1' : '0';
  if (op === '|') return (rxBool(l) || rxBool(r)) ? '1' : '0';

  // Comparisons
  const num_l = parseFloat(l), num_r = parseFloat(r);
  const bothNum = !isNaN(num_l) && !isNaN(num_r);
  function numCmp(): number { return num_l - num_r; }
  function strCmp(): number { return l.trim().toLowerCase().localeCompare(r.trim().toLowerCase()); }
  switch (op) {
    case '=':   return (bothNum ? numCmp() === 0 : strCmp() === 0) ? '1' : '0';
    case '==':  return (l === r) ? '1' : '0';
    case '\\=': case '~=': return (bothNum ? numCmp() !== 0 : strCmp() !== 0) ? '1' : '0';
    case '\\==': case '~==': return (l !== r) ? '1' : '0';
    case '<':   return (bothNum ? numCmp() < 0 : strCmp() < 0) ? '1' : '0';
    case '>':   return (bothNum ? numCmp() > 0 : strCmp() > 0) ? '1' : '0';
    case '<=':  return (bothNum ? numCmp() <= 0 : strCmp() <= 0) ? '1' : '0';
    case '>=':  return (bothNum ? numCmp() >= 0 : strCmp() >= 0) ? '1' : '0';
    case '\\<': case '~<': return (bothNum ? numCmp() >= 0 : strCmp() >= 0) ? '1' : '0';
    case '\\>': case '~>': return (bothNum ? numCmp() <= 0 : strCmp() <= 0) ? '1' : '0';
  }
  return l + r; // fallback (shouldn't reach)
}

function numStr(n: number): string {
  // Remove unnecessary decimal places, like REXX does
  if (Number.isInteger(n)) return String(n);
  // Up to 9 significant digits
  return parseFloat(n.toPrecision(9)).toString();
}

function rxBool(v: string): boolean {
  const t = v.trim();
  if (t === '1') return true;
  if (t === '0') return false;
  const n = parseFloat(t);
  if (!isNaN(n)) return n !== 0;
  throw new Error(`Not a boolean: "${v}"`);
}

function callBuiltin(name: string, argsJoined: string, ctx: EvalCtx): string {
  const args = argsJoined === '' ? [] : argsJoined.split('\x00');
  switch (name.toUpperCase()) {
    case 'LENGTH': return String((args[0] ?? '').length);
    case 'WORD':   { const parts=(args[0]??'').split(/\s+/); return parts[parseInt(args[1]??'1',10)-1]??''; }
    case 'WORDS':  return String((args[0]??'').split(/\s+/).filter(Boolean).length);
    case 'SUBSTR': { const s=args[0]??''; const st=parseInt(args[1]??'1',10)-1; const ln=args[2]?parseInt(args[2],10):undefined; return ln!=null?s.substr(st,ln):s.substr(st); }
    case 'LEFT':   return (args[0]??'').padEnd(parseInt(args[1]??'0',10)).slice(0,parseInt(args[1]??'0',10));
    case 'RIGHT':  return (args[0]??'').padStart(parseInt(args[1]??'0',10)).slice(-(parseInt(args[1]??'0',10)));
    case 'STRIP':  return (args[0]??'').trim();
    case 'UPPER':  return (args[0]??'').toUpperCase();
    case 'LOWER':  return (args[0]??'').toLowerCase();
    case 'ABS':    return String(Math.abs(parseFloat(args[0]??'0')));
    case 'MAX':    return String(Math.max(...args.map(Number)));
    case 'MIN':    return String(Math.min(...args.map(Number)));
    case 'TRUNC':  return String(Math.trunc(parseFloat(args[0]??'0')));
    case 'FORMAT': { const n=parseFloat(args[0]??'0'); const dec=parseInt(args[1]??'0',10); return n.toFixed(dec); }
    case 'D2C':    return String.fromCharCode(parseInt(args[0]??'0',10));
    case 'C2D':    return String((args[0]??'').charCodeAt(0));
    case 'COPIES': return (args[0]??'').repeat(Math.max(0,parseInt(args[1]??'0',10)));
    case 'REVERSE':return (args[0]??'').split('').reverse().join('');
    case 'POS':    return String((args[1]??'').indexOf(args[0]??'')+1);
    case 'LASTPOS':return String((args[1]??'').lastIndexOf(args[0]??'')+1);
    default: {
      // Unknown function — try dispatching as a command
      const cmd = name + (args.length ? ' ' + args.join(' ') : '');
      return ctx.dispatch(ctx.address, cmd);
    }
  }
}

function evalStmt(s: Stmt, ctx: EvalCtx): void {
  ctx.iterations++;
  if (ctx.iterations > ctx.maxIterations) throw new Error('Max iterations exceeded (infinite loop?)');

  switch (s.k) {
    case 'nop': return;

    case 'assign':
      ctx.env.set(s.name, evalExpr(s.val, ctx));
      return;

    case 'say':
      ctx.say(evalExpr(s.val, ctx));
      return;

    case 'address': {
      const env = evalExpr(s.env, ctx).toUpperCase();
      if (s.cmd) {
        // One-shot: send to env, keep current default
        const cmd = evalExpr(s.cmd, ctx);
        const result = ctx.dispatch(env, cmd);
        ctx.env.set('RESULT', result);
        ctx.env.set('RC', '0');
      } else {
        ctx.address = env;
      }
      return;
    }

    case 'cmd': {
      const parts = s.parts.map((p) => evalExpr(p, ctx));
      const cmd = parts.join(' ').trim();
      if (!cmd) return;
      try {
        const result = ctx.dispatch(ctx.address, cmd);
        ctx.env.set('RESULT', result);
        ctx.env.set('RC', '0');
      } catch (e) {
        ctx.env.set('RC', '10');
        ctx.env.set('RESULT', '');
        throw e;
      }
      return;
    }

    case 'do_range': {
      let i = parseFloat(evalExpr(s.from, ctx));
      const to = parseFloat(evalExpr(s.to, ctx));
      const by = s.by ? parseFloat(evalExpr(s.by, ctx)) : 1;
      if (isNaN(i) || isNaN(to) || isNaN(by) || by === 0) throw new Error('DO loop: invalid range');
      ctx.env.set(s.var, numStr(i));
      const cond = () => by > 0 ? i <= to : i >= to;
      while (cond()) {
        ctx.env.set(s.var, numStr(i));
        let shouldIterate = false;
        for (const stmt of s.body) {
          try { evalStmt(stmt, ctx); }
          catch (sig) {
            if (sig instanceof LeaveSignal) return;
            if (sig instanceof IterateSignal) { shouldIterate = true; break; }
            throw sig;
          }
        }
        if (!shouldIterate) { /* normal */ }
        i += by;
      }
      return;
    }

    case 'do_while': {
      while (rxBool(evalExpr(s.cond, ctx))) {
        for (const stmt of s.body) {
          try { evalStmt(stmt, ctx); }
          catch (sig) {
            if (sig instanceof LeaveSignal) return;
            if (sig instanceof IterateSignal) break;
            throw sig;
          }
        }
      }
      return;
    }

    case 'do_forever': {
      let runs = 0;
      const maxRuns = 100000;
      // If body has no LEAVE, cap at maxRuns
      outer: while (runs++ < maxRuns) {
        for (const stmt of s.body) {
          try { evalStmt(stmt, ctx); }
          catch (sig) {
            if (sig instanceof LeaveSignal) break outer;
            if (sig instanceof IterateSignal) break;
            throw sig;
          }
        }
      }
      return;
    }

    case 'if': {
      const cond = rxBool(evalExpr(s.cond, ctx));
      const branch = cond ? s.then : (s.else_ ?? []);
      for (const stmt of branch) evalStmt(stmt, ctx);
      return;
    }

    case 'leave':    throw new LeaveSignal();
    case 'iterate':  throw new IterateSignal();
    case 'exit': {
      const val = s.val ? evalExpr(s.val, ctx) : '0';
      throw new ExitSignal(val);
    }

    case 'parse_var': {
      const src = ctx.env.get(s.src) ?? s.src;
      const words = src.split(/\s+/).filter(Boolean);
      s.targets.forEach((name, idx) => {
        ctx.env.set(name, words[idx] ?? '');
      });
      return;
    }

    case 'parse_val': {
      const src = evalExpr(s.val, ctx);
      const words = src.split(/\s+/).filter(Boolean);
      s.targets.forEach((name, idx) => {
        ctx.env.set(name, words[idx] ?? '');
      });
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MODECAT COMMAND DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════

/** Note name → MIDI number (12 = C-0). Returns 0 for "---" / empty. */
function parseNoteName(s: string): number {
  const up = s.trim().toUpperCase();
  if (up === '---' || up === '' || up === '0') return 0;
  if (up === '-|-') return 254;
  // Formats: C-3  C#3  D-3  etc.
  const m = up.match(/^([A-G][#-])(\d)$/) ?? up.match(/^([A-G]#?)(\d)$/);
  if (!m) {
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 0 && n <= 255) return n;
    throw new Error(`Unknown note name: "${s}"`);
  }
  const nameMap: Record<string, number> = {
    'C-': 0, 'C#': 1, 'D-': 2, 'D#': 3, 'E-': 4, 'F-': 5,
    'F#': 6, 'G-': 7, 'G#': 8, 'A-': 9, 'A#': 10, 'B-': 11,
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
  };
  const semitone = nameMap[m[1]!];
  if (semitone === undefined) throw new Error(`Unknown note: "${s}"`);
  const octave = parseInt(m[2]!, 10);
  return (octave + 1) * 12 + semitone;
}

function parseHexByte(s: string): number {
  if (s === '--' || s === '---' || s === '') return 0;
  const n = parseInt(s, 16);
  if (isNaN(n)) throw new Error(`Not a hex byte: "${s}"`);
  return Math.max(0, Math.min(255, n));
}

/** Split a command string respecting quoted substrings. */
function splitCmd(cmd: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQ = false;
  let q = '';
  for (const ch of cmd) {
    if (inQ) {
      if (ch === q) { inQ = false; }
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      inQ = true; q = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (cur) { parts.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

/**
 * Create the ModeCat command dispatcher.
 * Returns a function (env, cmd) => result-string.
 * Only dispatches when env === 'MODECAT'; otherwise returns '' (no-op).
 *
 * Commands are documented in AREXX_COMMANDS.md.
 */
export function makeModeCatDispatcher(): (env: string, cmd: string) => string {
  return (env: string, cmd: string): string => {
    if (env !== 'MODECAT') return ''; // pass through unknown ports silently

    const parts = splitCmd(cmd.trim());
    const name = (parts[0] ?? '').toUpperCase();
    const args = parts.slice(1);

    const st = useStore.getState();

    switch (name) {

      // ── Queries ───────────────────────────────────────────────────────────

      case 'GETBPM':
        return String(st.transport.bpm);

      case 'GETSPEED':
        return String(st.transport.speed);

      case 'GETPATTERNCOUNT':
        return String(st.patterns.length);

      case 'GETCURRENTPATTERN': {
        // Returns the 0-based index into st.patterns[] for the active pattern
        const pat = st.activePattern();
        if (!pat) return '-1';
        return String(st.patterns.findIndex((p) => p.id === pat.id));
      }

      case 'GETPATTERNLENGTH': {
        const pat = st.activePattern();
        return pat ? String(pat.rows.length) : '0';
      }

      case 'GETSONGLEN':
        return String(st.song.positions.length);

      case 'GETSONGPOS':
        return String(st.transport.songPos);

      case 'GETPATTERNID': {
        // GETPATTERNID idx → pattern ID at index idx (0-based)
        const idx = parseInt(args[0] ?? '0', 10);
        return String(st.patterns[idx]?.id ?? -1);
      }

      case 'GETNOTE': {
        // GETNOTE row chan → note string (e.g. "C-3") at 1-based row/chan
        const row  = parseInt(args[0] ?? '1', 10) - 1;
        const chan = parseInt(args[1] ?? '1', 10) - 1;
        const pat  = st.activePattern();
        if (!pat) return '---';
        const cell = pat.rows[row]?.[chan];
        if (!cell) return '---';
        if (cell.note === 0) return '---';
        if (cell.note === 254) return '-|-';
        const NAMES = ['C-','C#','D-','D#','E-','F-','F#','G-','G#','A-','A#','B-'];
        const oct = Math.floor(cell.note / 12) - 1;
        return `${NAMES[cell.note % 12]}${oct}`;
      }

      case 'GETINST': {
        // GETINST row chan → instrument number (1-based, 0=none)
        const row  = parseInt(args[0] ?? '1', 10) - 1;
        const chan = parseInt(args[1] ?? '1', 10) - 1;
        const pat  = st.activePattern();
        if (!pat) return '0';
        return String(pat.rows[row]?.[chan]?.instrument ?? 0);
      }

      // ── Transport ─────────────────────────────────────────────────────────

      case 'SETBPM': {
        const bpm = Math.max(20, Math.min(255, parseInt(args[0] ?? '120', 10)));
        st.setTransport({ bpm });
        return String(bpm);
      }

      case 'SETSPEED': {
        const spd = Math.max(1, Math.min(15, parseInt(args[0] ?? '6', 10)));
        st.setTransport({ speed: spd });
        return String(spd);
      }

      // ── Pattern management ────────────────────────────────────────────────

      case 'ADDPATTERN': {
        // ADDPATTERN [name] — appends a new pattern; returns its 0-based index
        const newId = st.addPattern();
        const idx = st.patterns.length - 1;
        const name2 = args.join(' ').trim();
        if (name2) st.renamePattern(newId, name2);
        return String(idx);
      }

      case 'SELECTPATTERN': {
        // SELECTPATTERN idx — make pattern at 0-based idx the active one.
        // Appends it to the song if not already there, then sets songPos.
        const idx = Math.max(0, parseInt(args[0] ?? '0', 10));
        const pat = st.patterns[idx];
        if (!pat) throw new Error(`No pattern at index ${idx}`);
        // Find or create a song position pointing to this pattern
        let pos = st.song.positions.indexOf(pat.id);
        if (pos === -1) {
          st.insertSongPosition(st.song.positions.length, pat.id);
          pos = st.song.positions.length - 1;
        }
        st.setTransport({ songPos: pos, patternIndex: idx });
        return String(idx);
      }

      case 'SETPATTERNLENGTH': {
        const rows = Math.max(1, Math.min(3200, parseInt(args[0] ?? '64', 10)));
        st.setPatternLength(rows);
        return String(rows);
      }

      case 'RENAMEPATTERN': {
        // RENAMEPATTERN name
        const pat = st.activePattern();
        if (!pat) throw new Error('No active pattern');
        const newName = args.join(' ').trim();
        st.renamePattern(pat.id, newName);
        return newName;
      }

      case 'CLEARPATTERN': {
        // Clear all cells in the current pattern
        const pat = st.activePattern();
        if (!pat) return '0';
        const rows = pat.rows.length;
        const chans = pat.rows[0]?.length ?? 16;
        st.setRange({ startRow: 0, endRow: rows - 1, startCh: 0, endCh: chans - 1 });
        st.rangeClear();
        return String(rows * chans);
      }

      case 'CLEARTRACK': {
        // CLEARTRACK chan (1-based)
        const chan = Math.max(0, parseInt(args[0] ?? '1', 10) - 1);
        const pat  = st.activePattern();
        if (!pat) return '0';
        st.setRange({ startRow: 0, endRow: pat.rows.length - 1, startCh: chan, endCh: chan });
        st.rangeClear();
        return String(pat.rows.length);
      }

      // ── Song sequencing ───────────────────────────────────────────────────

      case 'APPENDSONG': {
        // APPENDSONG patidx — append pattern (0-based index) to song
        const idx = parseInt(args[0] ?? '0', 10);
        const pat  = st.patterns[idx];
        if (!pat) throw new Error(`No pattern at index ${idx}`);
        const pos  = st.song.positions.length;
        st.insertSongPosition(pos, pat.id);
        return String(pos);
      }

      case 'INSERTSONG': {
        // INSERTSONG pos patidx
        const pos = parseInt(args[0] ?? '0', 10);
        const idx = parseInt(args[1] ?? '0', 10);
        const pat = st.patterns[idx];
        if (!pat) throw new Error(`No pattern at index ${idx}`);
        st.insertSongPosition(pos, pat.id);
        return String(pos);
      }

      case 'REMOVESONG': {
        // REMOVESONG pos (0-based)
        const pos = parseInt(args[0] ?? '0', 10);
        st.removeSongPosition(pos);
        return String(pos);
      }

      case 'CLEARSONG': {
        const len = st.song.positions.length;
        for (let i = len - 1; i >= 0; i--) st.removeSongPosition(i);
        return String(len);
      }

      case 'RESETALL': {
        // Wipe song to blank state: clear song order, delete all patterns
        // except the first (clear its cells), reset all instruments to empty,
        // and restore default transport. Safe to call before running a snapshot.
        // 1. Clear song positions
        const posLen = st.song.positions.length;
        for (let i = posLen - 1; i >= 0; i--) st.removeSongPosition(i);
        // 2. Delete all patterns except the first
        const patIds = st.patterns.map((p: { id: number }) => p.id);
        for (let i = patIds.length - 1; i >= 1; i--) st.deletePattern(patIds[i]!);
        // 3. Clear cells in the remaining pattern, make it active
        const remaining = st.patterns[0];
        if (remaining) {
          // Ensure it's reachable via song pos so setRange/rangeClear work
          st.insertSongPosition(0, remaining.id);
          st.setTransport({ songPos: 0, patternIndex: 0 });
          const rows = remaining.rows.length;
          const chans = remaining.rows[0]?.length ?? 16;
          st.setRange({ startRow: 0, endRow: rows - 1, startCh: 0, endCh: chans - 1 });
          st.rangeClear();
          // Remove that temporary song position again
          st.removeSongPosition(0);
        }
        // 4. Reset all instruments to empty
        for (let i = 0; i < MAX_INSTRUMENTS; i++)
          st.setInstrument(i, { kind: 'empty', name: '--' } as import('../state/types').Instrument);
        // 5. Reset transport to defaults
        st.setTransport({ bpm: 125, speed: 6 });
        return 'OK';
      }

      // ── Note editing ──────────────────────────────────────────────────────

      case 'SETNOTE': {
        // SETNOTE row chan note inst cmd data  (all 1-based for row/chan/inst)
        // note: note string or MIDI number or --- or -|-
        // inst: 1-based instrument number or 0 to leave unchanged
        // cmd:  hex byte (e.g. 0A) or -- for none
        // data: hex byte (e.g. FF) or -- for none
        const row  = parseInt(args[0] ?? '1', 10) - 1;
        const chan = parseInt(args[1] ?? '1', 10) - 1;
        if (row < 0 || chan < 0) throw new Error('SETNOTE: row and chan must be >= 1');
        const note  = args[2] !== undefined ? parseNoteName(args[2]) : 0;
        const inst  = args[3] !== undefined ? Math.max(0, parseInt(args[3], 10)) : 0;
        const cmd2  = args[4] !== undefined ? parseHexByte(args[4]) : 0;
        const data  = args[5] !== undefined ? parseHexByte(args[5]) : 0;
        st.setCell(row, chan, { note, instrument: inst, cmd: cmd2, data });
        return `${row+1} ${chan+1} ${note} ${inst} ${cmd2} ${data}`;
      }

      case 'CLEARNOTE': {
        // CLEARNOTE row chan (1-based)
        const row  = parseInt(args[0] ?? '1', 10) - 1;
        const chan = parseInt(args[1] ?? '1', 10) - 1;
        st.clearCell(row, chan);
        return `${row+1} ${chan+1}`;
      }

      case 'SETNOTEONLY': {
        // SETNOTEONLY row chan note — set only the note field, leave instrument/fx
        const row  = parseInt(args[0] ?? '1', 10) - 1;
        const chan = parseInt(args[1] ?? '1', 10) - 1;
        const note = parseNoteName(args[2] ?? '---');
        st.setCell(row, chan, { note });
        return String(note);
      }

      case 'SETINST': {
        // SETINST row chan inst (1-based)
        const row  = parseInt(args[0] ?? '1', 10) - 1;
        const chan = parseInt(args[1] ?? '1', 10) - 1;
        const inst = Math.max(0, parseInt(args[2] ?? '0', 10));
        st.setCell(row, chan, { instrument: inst });
        return String(inst);
      }

      case 'SETFX': {
        // SETFX row chan cmd data (hex bytes)
        const row  = parseInt(args[0] ?? '1', 10) - 1;
        const chan = parseInt(args[1] ?? '1', 10) - 1;
        const cmd2 = parseHexByte(args[2] ?? '--');
        const data = parseHexByte(args[3] ?? '--');
        st.setCell(row, chan, { cmd: cmd2, data });
        return `${cmd2} ${data}`;
      }

      // ── Instrument ────────────────────────────────────────────────────────

      case 'SETINSTNAME': {
        // SETINSTNAME inst name (inst is 1-based)
        const idx  = Math.max(1, parseInt(args[0] ?? '1', 10)) - 1;
        const name2 = args.slice(1).join(' ').trim();
        const inst = st.instruments[idx];
        if (!inst) throw new Error(`No instrument at slot ${idx + 1}`);
        st.setInstrument(idx, { ...inst, name: name2 });
        return name2;
      }

      case 'GETINSTNAME': {
        // GETINSTNAME inst (1-based) → name string
        const idx = Math.max(1, parseInt(args[0] ?? '1', 10)) - 1;
        return st.instruments[idx]?.name ?? '';
      }

      default:
        throw new Error(`Unknown MODECAT command: ${name}`);
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

export interface RunOptions {
  /** Callback for SAY output (called per line). */
  say: (msg: string) => void;
  /** Command dispatcher — default: makeModeCatDispatcher(). */
  dispatch?: (env: string, cmd: string) => string;
  /** Maximum total statement executions before abort (default 500 000). */
  maxIterations?: number;
}

export interface RunResult {
  /** 0 = success, non-zero = error. */
  rc: number;
  /** Lines output by SAY. */
  output: string[];
  /** Error message if rc !== 0. */
  error?: string;
}

export function runARexx(script: string, opts: RunOptions): RunResult {
  const output: string[] = [];
  const say = (msg: string) => { output.push(msg); opts.say(msg); };
  const dispatch = opts.dispatch ?? makeModeCatDispatcher();

  const ctx: EvalCtx = {
    env: new Map([
      ['RC', '0'],
      ['RESULT', ''],
    ]),
    address: 'COMMAND',   // default — scripts must ADDRESS 'MODECAT' to talk to us
    say,
    dispatch,
    iterations: 0,
    maxIterations: opts.maxIterations ?? 500_000,
  };

  let stmts: Stmt[];
  try {
    stmts = parse(script);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { rc: 10, output, error: `Parse error: ${msg}` };
  }

  try {
    for (const s of stmts) evalStmt(s, ctx);
  } catch (sig) {
    if (sig instanceof ExitSignal) {
      const rc = parseInt(sig.val, 10);
      return { rc: isNaN(rc) ? 0 : rc, output };
    }
    if (sig instanceof LeaveSignal || sig instanceof IterateSignal) {
      return { rc: 0, output }; // LEAVE/ITERATE at top level = exit
    }
    const msg = sig instanceof Error ? sig.message : String(sig);
    return { rc: 10, output, error: msg };
  }

  return { rc: 0, output };
}

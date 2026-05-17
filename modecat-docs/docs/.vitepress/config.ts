import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ModeCat',
  description: 'Browser-based music tracker — documentation',
  cleanUrls: true,

  themeConfig: {
    logo: '/logo.png',

    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Advanced', link: '/advanced/' },
      { text: 'GitHub', link: 'https://github.com/matrule/modecat' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/introduction' },
          { text: 'Quick Start', link: '/quick-start' },
        ],
      },
      {
        text: 'User Guide',
        items: [
          { text: 'The Interface', link: '/guide/interface' },
          { text: 'Blocks & Song', link: '/guide/blocks-and-song' },
          { text: 'Instruments', link: '/guide/instruments' },
          { text: 'Sample Editor', link: '/guide/sample-editor' },
          { text: 'Pattern Entry', link: '/guide/pattern-entry' },
          { text: 'Effect Commands', link: '/guide/effect-commands' },
          { text: 'Range Operations', link: '/guide/range-operations' },
          { text: 'Saving & Loading', link: '/guide/saving-loading' },
        ],
      },
      {
        text: 'Advanced',
        items: [
          { text: 'ARexx Scripting', link: '/advanced/arexx' },
          { text: 'MIDI Bridge', link: '/advanced/bridge' },
          { text: 'File Format', link: '/advanced/file-format' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'ModeCat v1.0',
    },

    editLink: {
      pattern: 'https://github.com/matrule/modecat-docs/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})

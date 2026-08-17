import { defineConfig } from 'vitepress'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withOpenInEditor } from '../../src/index'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default withOpenInEditor(
  defineConfig({
    title: 'open-in-editor demo',
    description: 'Local playground for vitepress-plugin-open-in-editor',
    themeConfig: {
      nav: [{ text: 'Home', link: '/' }],
      editLink: {
        text: '在编辑器中打开本页',
      },
    },
  }),
  {
    docsDir: resolve(__dirname, '..'),
  },
)

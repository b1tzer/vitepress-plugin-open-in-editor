import { defineConfig } from 'vitepress'
import { withOpenInEditor } from '../../src/index'

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
)

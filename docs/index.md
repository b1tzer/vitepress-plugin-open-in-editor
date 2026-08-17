# open-in-editor demo

This is a local playground to verify `vitepress-plugin-open-in-editor` changes quickly.

Hover over any block element below — a floating **「编辑此行」** button should appear. Click it to jump straight to the corresponding source line in your editor.

## Getting started

Run the demo with:

```bash
npm run demo:dev
```

Then open the printed URL in a browser. Make sure your editor CLI (e.g. `code`) is on `$PATH`.

## A paragraph to hover

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

## A list to hover

- First list item
- Second list item
- Third list item

## A table to hover

| Feature | Status |
| ------- | ------ |
| Hover-to-open | ✅ |
| editLink integration | ✅ |
| Line-accurate | ✅ |

## A quote to hover

> Every block-level element carries a `data-src-line` attribute injected at markdown-it render time.

## A code block to hover

```ts
export function greet(name: string): string {
  return `Hello, ${name}!`
}
```

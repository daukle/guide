import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, escapeHtml } from "../src/render.mjs";

test("a fenced block is escaped, not interpreted", () => {
  const { html } = renderMarkdown('```toml\nname = "<a>&b"\n```');
  assert.match(html, /<pre><code class="language-toml">/);
  assert.match(html, /name = &quot;&lt;a&gt;&amp;b&quot;/);
  assert.doesNotMatch(html, /<a>/);
});

test("inline markup inside a fenced block stays literal", () => {
  // A snippet showing **bold** or `code` as syntax must survive verbatim, which
  // is the whole reason the fence is handled before anything else.
  const { html } = renderMarkdown("```\n**not bold** and `not code`\n```");
  assert.match(html, /\*\*not bold\*\* and `not code`/);
});

test("headings carry a slug a link can reach", () => {
  const { headings } = renderMarkdown("## What it does not do\n");
  assert.deepEqual(headings, [{ level: 2, text: "What it does not do", id: "what-it-does-not-do" }]);
});

test("a table drops its alignment row and keeps every cell", () => {
  const { html } = renderMarkdown("| key | meaning |\n| --- | --- |\n| `a` | one |\n| b | two |");
  assert.match(html, /<th>key<\/th><th>meaning<\/th>/);
  assert.match(html, /<td><code>a<\/code><\/td><td>one<\/td>/);
  assert.match(html, /<td>b<\/td><td>two<\/td>/);
  assert.doesNotMatch(html, /---/);
});

test("a table row with a trailing pipe loses no cell", () => {
  const { html } = renderMarkdown("| a | b |\n| --- | --- |\n| one | two |");
  assert.match(html, /<td>one<\/td><td>two<\/td>/);
});

test("a list ends when the list ends", () => {
  const { html } = renderMarkdown("- one\n- two\n\nafter");
  assert.equal(html, "<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<p>after</p>");
});

test("a paragraph joins its wrapped lines", () => {
  const { html } = renderMarkdown("one\ntwo\n\nthree");
  assert.match(html, /<p>one two<\/p>/);
  assert.match(html, /<p>three<\/p>/);
});

test("a link renders and its label is still escaped", () => {
  const { html } = renderMarkdown("see [the <docs>](https://example.invalid/a)");
  assert.match(html, /<a href="https:\/\/example\.invalid\/a">the &lt;docs&gt;<\/a>/);
});

test("escapeHtml covers every character that could close a tag or an attribute", () => {
  assert.equal(escapeHtml('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;");
});

test("nothing in the renderer emits an em-dash or an en-dash", () => {
  // The org forbids both everywhere, including generated output, so this is
  // asserted rather than remembered.
  const source = renderMarkdown("# a\n\n- b\n\n| c |\n| --- |\n| d |\n").html;
  assert.doesNotMatch(source, /[–—]/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("web styles keep an explicit product-boundary cascade", async () => {
  const source = await readFile(new URL("apps/web/src/styles.css", root), "utf8");
  assert.equal(
    source,
    [
      '@import "./styles/tokens.css";',
      '@import "./styles/product-features.css";',
      '@import "./styles/reporter-shell.css";',
      '@import "./styles/team-shell.css";',
      '@import "./styles/reporter-features.css";',
      '@import "./styles/source-management.css";',
      '@import "./styles/entry-surfaces.css";',
      "",
    ].join("\n"),
  );
  const styles = await Promise.all(
    [
      "tokens.css",
      "product-features.css",
      "reporter-shell.css",
      "team-shell.css",
      "reporter-features.css",
      "source-management.css",
      "entry-surfaces.css",
    ].map((name) => readFile(new URL(`apps/web/src/styles/${name}`, root), "utf8")),
  );
  assert.equal(styles.join("\n").match(/:root\s*\{/gu)?.length, 1);
});

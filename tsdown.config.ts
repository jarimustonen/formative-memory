import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  env: { NODE_ENV: "production" },
  fixedExtension: false,
  platform: "node",
  external: ["openclaw", /^openclaw\//],
  noExternal: ["@sinclair/typebox", "markdown-it"],
});

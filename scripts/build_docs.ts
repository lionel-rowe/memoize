import { expandGlob } from "@std/fs";
import { relative } from "@std/path";
import { load } from "cheerio";

await new Deno.Command(
  "deno",
  { args: "doc --html --name=Memoize ./src".split(" ") },
).spawn().output();

const cwd = import.meta.resolve("./..");
const rootUrl = "https://github.com/lionel-rowe/memoize/tree/main/";

await Deno.writeFile("./docs/.nojekyll", new Uint8Array());

for await (const f of expandGlob("./docs/**/*.html")) {
  if (f.isFile) {
    const $ = load(await Deno.readTextFile(f.path));

    for (const x of $("[href], [src]")) {
      const $x = $(x);
      for (const attr of ["href", "src"]) {
        const val = $x.attr(attr);
        if (val && val.startsWith(cwd)) {
          const rel = relative(cwd, val);
          const { href } = new URL(rel, rootUrl);
          $x.attr(attr, href);
        }
      }
    }

    await Deno.writeTextFile(f.path, $.html());
  }
}

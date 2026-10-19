// Registered with `node --import ./tests/register-hooks.mjs`; see ./ts-hooks.mjs.
import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);

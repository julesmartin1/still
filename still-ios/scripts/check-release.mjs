import { readFile } from "node:fs/promises";
const facts = JSON.parse(await readFile("release-facts.json", "utf8")),
  config = JSON.parse(await readFile("capacitor.config.json", "utf8"));
const blockers = [];
for (const [key, value] of Object.entries(facts))
  if (
    value === null ||
    value === false ||
    (Array.isArray(value) && !value.length)
  )
    blockers.push(key);
if (config.appId.includes("example") || config.appId !== facts.bundleIdentifier)
  blockers.push("final bundle identifier must match config");
if (config.server?.url || config.server?.allowNavigation?.length)
  blockers.push("remote app navigation is enabled");
const html = await readFile("dist/privacy.html", "utf8");
if (/development draft|not the final publisher/i.test(html))
  blockers.push("final privacy policy is not present");
if (blockers.length) {
  console.error(
    "NOT SUBMISSION READY\n" + blockers.map((x) => "• " + x).join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    "Recorded release facts complete. Independently verify the signed archive and submission evidence before release.",
  );

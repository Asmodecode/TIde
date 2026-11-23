// Writes the update file installed apps read: one signed download per platform, from a release.
//   node .github/update-manifest.cjs <sigs folder> <release tag> <version> <notes file> <out file>
// The build workflow runs it for a tagged release (latest.json, the Stable channel) and for every
// build of main (nightly.json on the rolling "latest" release, the Nightly channel).
const fs = require("fs");
const [sigs, release, version, notesFile, out] = process.argv.slice(2);
const repo = process.env.REPO;
const kinds = [
  [/_x64-setup\.exe\.sig$/, "windows-x86_64"],
  [/_aarch64\.app\.tar\.gz\.sig$/, "darwin-aarch64"],
  [/_x64\.app\.tar\.gz\.sig$/, "darwin-x86_64"],
  [/_amd64\.AppImage\.sig$/, "linux-x86_64"],
];
const platforms = {};
for (const file of fs.readdirSync(sigs)) {
  const kind = kinds.find(([re]) => re.test(file));
  if (!kind) continue;
  platforms[kind[1]] = {
    signature: fs.readFileSync(`${sigs}/${file}`, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${release}/${file.slice(0, -4)}`,
  };
}
if (Object.keys(platforms).length < kinds.length)
  console.log(`::warning::${out} covers only ${Object.keys(platforms).join(", ") || "no platforms"}`);
const notes = fs.readFileSync(notesFile, "utf8").trim();
fs.writeFileSync(out, JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2));

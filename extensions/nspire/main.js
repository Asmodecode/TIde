// @ts-check
// Nspire: the toolchain commands for the TI-Nspire CX. Build a Ndless C/C++ project with make,
// pack a .lua/.py script into a .tns with Luna, scaffold a new Ndless project in the open folder,
// and send files to the calculator panel's Nspire. Completions and hover help are in extension.json.

/** @param {Tide} tide */
export function activate(tide) {
  const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  const dirName = (p) => {
    const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return i < 0 ? "." : p.slice(0, i);
  };
  const lunaCmd = () => String(tide.settings().luna || "luna").trim() || "luna";

  /** The active file, when it has one of the given extensions, with its absolute path. */
  function activeFile(exts) {
    const f = tide.editor.file();
    if (!f || !f.path) return null;
    const ext = baseName(f.path).split(".").pop().toLowerCase();
    return exts.includes(ext) ? { ...f, ext } : null;
  }

  /** Whether a file exists in the open folder (files.readBinary is relative to it). */
  async function existsInProject(rel) {
    try {
      await tide.files.readBinary(rel);
      return true;
    } catch {
      return false;
    }
  }

  /** Sends files to the calculator, requiring a TI-Nspire for .tns. Resolves true when sent. */
  async function sendToCalc(files) {
    await tide.calculator.show();
    const family = await tide.calculator.family();
    if (family !== "nspire") {
      tide.message("Pick the TI-Nspire CX in the calculator's model menu to send .tns files.");
      return false;
    }
    await tide.calculator.send(files);
    return true;
  }

  // Only in a project for the TI-Nspire CX: other projects, and no folder at all, don't show them.
  const nspireOnly = { when: { calculator: ["nspire"] } };

  // One-click build: make in the open folder (the Ndless SDK folder setting puts the SDK's bin on PATH).
  tide.commands.register("build", "Nspire: Build project (make)", async () => {
    const project = tide.project();
    if (!project) return tide.message("Open a folder with a Ndless Makefile first.");
    const r = await tide.run("make");
    tide.message(r.ok ? `Built ${project.name}` : "Build failed: see the Output tab");
  }, nspireOnly);

  // Pack the active .lua/.py into a .tns with Luna, next to the script, and send it to the Nspire.
  tide.commands.register("pack", "Nspire: Pack with Luna and send", async () => {
    const f = activeFile(["lua", "py"]);
    if (!f) return tide.message("Open a .lua or .py script to pack with Luna.");
    const name = baseName(f.path);
    if ((await tide.files.read(f.path)) !== tide.editor.text())
      return tide.message(`Save ${name} first (Ctrl+S) — Luna packs the file on disk.`);
    const out = name.replace(/\.(lua|py)$/i, "") + ".tns";
    const r = await tide.run(`"${lunaCmd()}" "${name}" "${out}"`, dirName(f.path));
    if (!r.ok) return tide.message("Luna failed: see the Output tab");
    const bytes = await tide.files.readBinary(f.path.slice(0, f.path.length - name.length) + out);
    if (await sendToCalc([{ name: out, bytes }])) tide.message(`Sent ${out} to the TI-Nspire CX`);
  }, nspireOnly);

  // Send the active .tns document to the calculator.
  tide.commands.register("send", "Nspire: Send file to the calculator", async () => {
    const f = activeFile(["tns", "tno", "tnc"]);
    if (!f) return tide.message("Open a .tns document to send it.");
    const bytes = await tide.files.readBinary(f.path);
    if (await sendToCalc([{ name: baseName(f.path), bytes }]))
      tide.message(`Sent ${baseName(f.path)} to the TI-Nspire CX`);
  }, nspireOnly);

  // Scaffold a Ndless project in the open folder: Makefile and main.c from the SDK's own templates,
  // plus a .tide/tide.json that marks the project for the Nspire. Nothing is overwritten.
  tide.commands.register("new", "Nspire: New Ndless project files", async () => {
    const project = tide.project();
    if (!project) return tide.message("Open a folder to put the Ndless project in.");
    for (const name of ["Makefile", "main.c", ".tide/tide.json"]) {
      if (await existsInProject(name)) return tide.message(`${name} already exists — nothing was overwritten.`);
    }
    const exe = project.name.replace(/[^A-Za-z0-9_-]/g, "") || "nspire";
    const makefile = (await tide.files.read("Makefile.tpl")).replaceAll("@@EXENAME@@", exe);
    const mainC = await tide.files.read("main.c.tpl");
    const config = `{
  // A TI-Nspire CX (Ndless) project: Build runs make, Run sends the .tns to the calculator.
  "calculator": "nspire",
  "build": "make",
  "send": ["*.tns", "bin/*.tns"],
  "scripts": { "clean": "make clean" }
}
`;
    try {
      await tide.files.write("Makefile", makefile);
      await tide.files.write("main.c", mainC);
      await tide.files.write(".tide/tide.json", config);
      await tide.files.open("main.c");
      tide.message(`Created Makefile, main.c and .tide/tide.json in ${project.name} — F5 builds and sends.`);
    } catch (err) {
      tide.message(`Could not create the project files: ${err}`);
    }
  }, nspireOnly);
}

export function deactivate() {}

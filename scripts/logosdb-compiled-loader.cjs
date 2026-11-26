/**
 * Load the LogosDB N-API addon from beside a Bun-compiled executable.
 *
 * `bindings` walks upward from the caller filename looking for package.json.
 * Inside `bun build --compile` that filename is a virtual path
 * (`B:/~BUN/root/trek.exe` on Windows, `/$bunfs/...` elsewhere), so the walk
 * throws before `--help` returns. The archives ship `native/logosdb.node`
 * next to trek.exe / trek. This loader opens that file and does not call
 * `bindings` on a virtual path.
 *
 * The compile step inlines the marked section into logosdb's entry module.
 */

"use strict";

// BEGIN INJECT
function isBunVirtualPath(file) {
	const value = String(file || "");
	return value.includes("~BUN") || value.includes("$bunfs");
}

function logosdbSidecar(execPath) {
	const pathApi = require("node:path");
	return pathApi.join(pathApi.dirname(String(execPath || "")), "native", "logosdb.node");
}

function loadLogosdbNative(deps) {
	const fs = deps && deps.fs ? deps.fs : require("node:fs");
	const pathApi = deps && deps.path ? deps.path : require("node:path");
	const execPath = deps && deps.execPath ? deps.execPath : process.execPath;
	const filename = deps && typeof deps.filename === "string" ? deps.filename : typeof __filename === "string" ? __filename : "";
	const sidecar = pathApi.join(pathApi.dirname(execPath), "native", "logosdb.node");
	if (fs.existsSync(sidecar)) {
		const nativeModule = { exports: {} };
		const dlopen = deps && deps.dlopen ? deps.dlopen : (mod, file) => process.dlopen(mod, file);
		dlopen(nativeModule, sidecar);
		return nativeModule.exports;
	}
	const virtual = isBunVirtualPath(filename) || isBunVirtualPath(execPath);
	if (!virtual && deps && typeof deps.bindings === "function") {
		return deps.bindings("logosdb");
	}
	throw new Error(
		'Could not find LogosDB native addon next to the Trek executable: "' +
			sidecar +
			'". Keep native/logosdb.node beside the executable.',
	);
}
// END INJECT

module.exports = {
	isBunVirtualPath,
	logosdbSidecar,
	loadLogosdbNative,
};

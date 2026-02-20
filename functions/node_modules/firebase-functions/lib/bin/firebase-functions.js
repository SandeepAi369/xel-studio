#!/usr/bin/env node
"use strict";
// The MIT License (MIT)
//
// Copyright (c) 2022 Firebase
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const loader_1 = require("../runtime/loader");
const manifest_1 = require("../runtime/manifest");
function printUsageAndExit() {
    console.error(`
Usage: firebase-functions [functionsDir]

Arguments:
  - functionsDir: Directory containing source code for Firebase Functions.
`);
    process.exit(1);
}
let functionsDir = ".";
const args = process.argv.slice(2);
if (args.length > 1) {
    if (args[0] === "-h" || args[0] === "--help") {
        printUsageAndExit();
    }
    functionsDir = args[0];
}
function handleQuitquitquit(req, res, server) {
    res.send("ok");
    server.close();
}
if (process.env.FUNCTIONS_MANIFEST_OUTPUT_PATH) {
    void (async () => {
        var _a;
        const outputPath = process.env.FUNCTIONS_MANIFEST_OUTPUT_PATH;
        try {
            // Validate the output path
            const dir = path.dirname(outputPath);
            try {
                await fs.access(dir, fs.constants.W_OK);
            }
            catch (e) {
                console.error(`Error: Cannot write to directory '${dir}': ${e instanceof Error ? e.message : String(e)}`);
                console.error("Please ensure the directory exists and you have write permissions.");
                process.exit(1);
            }
            const stack = await (0, loader_1.loadStack)(functionsDir);
            const wireFormat = (0, manifest_1.stackToWire)(stack);
            await fs.writeFile(outputPath, JSON.stringify(wireFormat, null, 2));
            process.exit(0);
        }
        catch (e) {
            if (e.code === "ENOENT") {
                console.error(`Error: Directory '${path.dirname(outputPath)}' does not exist.`);
                console.error("Please create the directory or specify a valid path.");
            }
            else if (e.code === "EACCES") {
                console.error(`Error: Permission denied writing to '${outputPath}'.`);
                console.error("Please check file permissions or choose a different location.");
            }
            else if ((_a = e.message) === null || _a === void 0 ? void 0 : _a.includes("Failed to generate manifest")) {
                console.error(e.message);
            }
            else {
                console.error(`Failed to generate manifest from function source: ${e instanceof Error ? e.message : String(e)}`);
            }
            if (e instanceof Error && e.stack) {
                console.error(e.stack);
            }
            process.exit(1);
        }
    })();
}
else {
    let server = undefined;
    const app = express();
    app.get("/__/quitquitquit", (req, res) => handleQuitquitquit(req, res, server));
    app.post("/__/quitquitquit", (req, res) => handleQuitquitquit(req, res, server));
    if (process.env.FUNCTIONS_CONTROL_API === "true") {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        app.get("/__/functions.yaml", async (req, res) => {
            try {
                const stack = await (0, loader_1.loadStack)(functionsDir);
                res.setHeader("content-type", "text/yaml");
                res.send(JSON.stringify((0, manifest_1.stackToWire)(stack)));
            }
            catch (e) {
                console.error(e);
                const errorMessage = e instanceof Error ? e.message : String(e);
                res.status(400).send(`Failed to generate manifest from function source: ${errorMessage}`);
            }
        });
    }
    let port = 8080;
    if (process.env.PORT) {
        port = Number.parseInt(process.env.PORT);
    }
    console.log("Serving at port", port);
    server = app.listen(port);
}

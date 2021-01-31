#!/usr/bin/env node

"use strict";

const compile       = require('./compile'),
      getopt        = require("node-getopt"),
      FS            = require("fs"),
      PATH          = require('path');


let opt = getopt.create([
    ["o", "output=FILE", "output .js file"]
]);

opt.setHelp(
    "Usage: ojc [OPTIONS] INPUT_FILES\n" +
    "\n" +
    "[[OPTIONS]]\n" +
    "\n"
);

opt.bindHelp();
opt.parseSystem();

let argv = opt.argv;
let options = opt.options;

// Bail if no input files (specified after options)
if (!argv || argv.length === 0) {
    console.error("ojc: error: no input files");
    process.exit(1);
}

let final = {
    code: "",
    sourceMap: null
};

if (argv.length === 1) {
    const pathName = PATH.resolve(argv[0]);
    const relPath = PATH.relative(process.cwd(), pathName);
    try {
        let source = FS.readFileSync(pathName, 'utf8');
        final = Object.assign(final, compile(source, pathName));
        if (final.error) {
            let err = final.error;
            console.error(`Compilation error in ${relPath} at (${err.lineInfo.line}, ${err.lineInfo.column}): ${err.message}`);
            process.exit(1);
        }

        final.classDefs = Object.fromEntries(final.classDefs);

    } catch (e) {
        console.log(e);
        console.error(`File not found: ${pathName}`);
    }
} else {
    console.error("Error: ojc only compiles one file at a time.")
    process.exit(1);
}

console.log(final.issues);

final.issues.forEach((issue) => {
    let severity = issue.severity.toUpperCase();
    let sourceFile = PATH.relative(process.cwd(), issue.file);
    let lineInfo = issue.lineInfo;
    console.log(`${severity}: ${issue.message} in ${sourceFile} at (${lineInfo.line},${lineInfo.column})`);
});

let outputFile = options["output"];
if (outputFile) {
    FS.mkdirSync(PATH.dirname(outputFile), {recursive: true});
    FS.writeFileSync(outputFile, final.code, 'utf8');
} else {
    console.log(final.code);
}

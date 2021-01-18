#!/usr/bin/env node

"use strict";

const AcornObj = require("acorn-objj"),
    CompilerObj = require("./lib/compiler.js"),
    CodeGenerator = require("./lib/code-generator.js"),
    IssueHandler = require("acorn-issue-handler"),
    getopt = require("node-getopt"),
    FS = require("fs"),
    PATH = require('path');


function compile(source, sourcePath) {

    //acorn options
    const options = {
        sourceType: 'module'
    };

    let issues = new IssueHandler.IssueList(),
        ast = null;
    try {
        ast = AcornObj.parse.parse(source, options, issues);
    } catch (ex) {
        if (IssueHandler.isIssue(ex)) {
            printIssue(ex, sourcePath);
        } else {
            throw ex;
        }
    }

    if (ast) {
        const cOptions = {
            objjScope: false,
            classDefs: new Map(),
            protocolDefs: new Map(),
            typedefs: new Map(),
            importedFiles: new Set()
        };

        global.DEBUG = false;

        Object.assign(CompilerObj.defaultOptions, cOptions);

        const compiler = new CompilerObj.Compiler(source, sourcePath, ast, issues, CompilerObj.defaultOptions);
        compiler.compileWithFormat(CodeGenerator);

        if (compiler.errorCount > 0) {
            let count = compiler.errorCount,
                i = 0,
                errors = false;
            for (; i < count; i++) {
                let ex = compiler.issuesList.issues[i];
                if (ex.severity === 'error') {
                    printIssue(ex, sourcePath);
                    errors = true;
                }
            }

            if (errors)
                return;
        }
        return compiler.code;
    }
}

function printIssue(ex, sourcePath) {

    let buf = [];
    if (ex) {
        buf.push(ex.name + ':');
        if (ex.message) {
            buf.push(ex.message);
        }

        if (ex.source) {
            buf.push('"' + ex.source.trim() + '"\t(' + sourcePath + ', line: ' + ex.lineInfo.line + ', column: ' + ex.lineInfo.column + ')');
        }
    }

    return buf.join("\n");
}


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
if (!argv || argv.length == 0) {
    console.error("ojc: error: no input files");
    process.exit(1);
}


let out = "";
for (let i in argv) {
    const pathName = PATH.resolve(argv[i]);
    try {
        let source = FS.readFileSync(pathName, 'utf8');
        let code = compile(source, pathName);
        out += code;
    } catch (e) {
        console.log(e);
        console.error(`File not found: ${pathName}`);
    }
}

let outputFile = options["output"];
if (outputFile) {
    FS.writeFileSync(outputFile, out, 'utf8');
} else {
    console.log(out);
}

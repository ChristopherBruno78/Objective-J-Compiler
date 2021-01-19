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
            sourceMap: false,
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
        return {code: compiler.code};//, sourceMap : JSON.parse(compiler.sourceMap)}
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


let final = {
    code: "",
    sourceMap: null
};

if (argv.length === 1) {
    const pathName = PATH.resolve(argv[0]);
    try {
        let source = FS.readFileSync(pathName, 'utf8');
        final = compile(source, pathName);

    } catch (e) {
        console.log(e);
        console.error(`File not found: ${pathName}`);
    }
} else {
    console.error("Error: ojc only compiles one file at a time.")
    process.exit(1);
}

let outputFile = options["output"];
if (outputFile) {

    FS.mkdirSync(PATH.dirname(outputFile), {recursive: true});
    FS.writeFileSync(outputFile, final.code, 'utf8');
    // FS.writeFileSync(
    //     PATH.basename(outputFile) + ".map",
    //      JSON.stringify(final.sourceMap, null, 2),
    //      "utf8"
    // );
} else {
    console.log(final.code);
}

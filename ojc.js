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
            return {error: ex}
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
            sourceMap: false
        };

        global.DEBUG = false;

        Object.assign(CompilerObj.defaultOptions, cOptions);

        const compiler = new CompilerObj.Compiler(source, sourcePath, ast, issues, CompilerObj.defaultOptions);
        compiler.compileWithFormat(CodeGenerator);

        let compilerIssues = [];
        if (compiler.issueCount > 0) {
            let count = compiler.issueCount,
                i = 0;
            for (; i < count; i++) {
                let ex = compiler.issues.issues[i];
                compilerIssues.push(ex);
            }
        }
        return {code: compiler.code, issues: compilerIssues || []};//, sourceMap : JSON.parse(compiler.sourceMap)}
    }
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
    } catch (e) {
        console.log(e);
        console.error(`File not found: ${pathName}`);
    }
} else {
    console.error("Error: ojc only compiles one file at a time.")
    process.exit(1);
}

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

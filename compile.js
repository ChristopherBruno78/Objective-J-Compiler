const AcornObj = require("acorn-objj"),
      CompilerObj = require("./lib/compiler.js"),
      CodeGenerator = require("./lib/code-generator.js"),
      IssueHandler = require("acorn-issue-handler");

module.exports = function(source, sourcePath) {
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
        return {
            code: compiler.code,
            superclassRefs: compiler.superclassRefs,
            classDefs : Object.fromEntries(compiler.classDefs),
            issues: compilerIssues || []
        };//, sourceMap : JSON.parse(compiler.sourceMap)}
    }
}
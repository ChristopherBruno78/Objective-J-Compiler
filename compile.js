const AcornObj = require("acorn-objj"),
  CompilerObj = require("./lib/compiler.js"),
  CodeGenerator = require("./lib/code-generator.js"),
  IssueHandler = require("acorn-issue-handler");

module.exports = function (source, sourcePath) {
  //acorn options
  let comments = [];
  const options = {
    sourceType: "module",
    onComment: comments,
    preprocessor: true,
  };
  let issues = new IssueHandler.IssueList(),
    ast = null;
  try {
    ast = AcornObj.parse.parse(source, options, issues);
  } catch (ex) {
    if (IssueHandler.isIssue(ex)) {
      return { error: ex };
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
    };

    global.DEBUG = false;

    Object.assign(CompilerObj.defaultOptions, cOptions);

    const compiler = new CompilerObj.Compiler(
      source,
      sourcePath,
      ast,
      issues,
      CompilerObj.defaultOptions
    );
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
      ast: ast,
      code: compiler.code,
      classDefs: Object.fromEntries(compiler.classDefs),
      superclassRefs: compiler.superclassRefs,
      issues: compilerIssues || [],
      dependencies: compiler.dependencies,
    };

    //, sourceMap : JSON.parse(compiler.sourceMap)}
  }
};

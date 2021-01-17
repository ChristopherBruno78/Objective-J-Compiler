
const AcornObj = require("acorn-objj"),
CompilerObj = require("./lib/compiler.js"),
CodeGenerator = require("./lib/code-generator.js"),
IssueHandler = require("acorn-issue-handler"),
fs = require("fs"),
path = require('path');


function compile(source, sourcePath) {

	//acorn options
	var options = {
		sourceType : 'module'
	};

	let issues = new IssueHandler.IssueList(),
		  ast = null;
	 try {

		 ast = AcornObj.parse.parse(source, options, issues);

	 } catch (ex) {
         if (IssueHandler.isIssue(ex)) {
			         printIssue(ex, sourcePath);
         }
         else {
             throw ex;
         }
	 }

	 if ( ast ) {
	   var cOptions = {
	 		      objjScope : false,
            classDefs : new Map(),
            protocolDefs : new Map(),
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

	 return;
};

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

const fileNames = process.argv.slice(2);

let out = "";
for(var i in fileNames) {
   const pathName = path.resolve(fileNames[i]);
   try {
      let source = fs.readFileSync(pathName, 'utf8');
      let code = compile(source, pathName);
      out += code;
   }catch(e) {
      console.log(e);
      console.error(`File not found: ${pathName}`);
   }
}

console.log(out);

"use strict";

const FS = require("fs");
const AcornObj = require("acorn-objj");

/**
 * cleans a comment
 * @param str
 * @returns {string|*|string}
 */
function cleanComment(str) {
  let trimmed = str.trim();
  if (trimmed.length > 0) {
    return trimmed.replace(/\n/g, " ").trim();
  }
  return trimmed;
}

function parseComment(commentStr) {
  commentStr = cleanComment(commentStr);
  let commentObj = { data: [] };
  let split = commentStr.split("@");
  split.shift(); //discard anything before the first @
  let i = 0;
  split.forEach((part) => {
    let s = part.split(" ");
    if (s.length > 0) {
      let key = `@${s[0]}`;
      s.shift();
      if (i === 0) {
        commentObj.type = key;
        commentObj.description = s.join(" ").trim();
      } else {
        commentObj.data.push({
          key: key,
          text: s.join(" ").trim(),
        });
      }
      i++;
    }
  });
  return commentObj;
}

/**
 * Find the first class declaration
 * @param node
 * @returns {null|*}
 */
function getTopLevelNodes(ast) {
  let toDocument = {
    cls: [],
    funcs: [],
  };
  if (ast.type === "Program") {
    if (ast.body.length) {
      ast.body.forEach((node) => {
        if (node.type === "objj_ClassDeclaration") {
          toDocument.cls.push(node);
        } else if (node.type === "FunctionDeclaration") {
          toDocument.funcs.push(node);
        }
      });
    }
  }
  return toDocument;
}

/**
 * Documents a method node from an ast
 * @param node
 * @returns the documented method object
 */
function documentMethod(node) {
  let theMethod = {};
  if (node.type === "objj_MethodDeclaration") {
    if (node.objj) {
      theMethod.methodType = node.objj.methodType;
      if (node.objj.returnType) {
        theMethod.returnType = node.objj.returnType.objj.name;
      }

      if (node.objj.selectors) {
        theMethod.selectors = [];
        node.objj.selectors.forEach((sel) => {
          theMethod.selectors.push(sel.name);
        });
      }

      theMethod.params = [];
      if (node.objj.params) {
        node.objj.params.forEach((p) => {
          theMethod.params.push({
            type: p.type.objj.name,
            id: p.id.name,
          });
        });
      }

      theMethod.declaration = `${theMethod.methodType}(${theMethod.returnType})`;
      let i = 0,
        count = theMethod.params.length + 1;
      for (; i < count; i++) {
        if (i > 0) {
          let p = theMethod.params[i - 1];
          if (p) {
            theMethod.declaration += ":";
            theMethod.declaration += `(${p.type})`;
            theMethod.declaration += `${p.id || "aValue"}\n`;
          }
        }
        if (i < theMethod.selectors.length) {
          theMethod.declaration += theMethod.selectors[i];
        }
      }
    }

    return theMethod;
  }
}

/**
 * Documents a class from a class node ast
 * @param node
 * @returns the documented class object
 */
function documentClass(node) {
  let theClass = { methods: [] };
  if (node.objj) {
    theClass.name = node.objj.name.name;
    let body = node.objj.body;
    if (body) {
      body.forEach((item) => {
        if (item.type === "objj_MethodDeclaration") {
          let theMethod = documentMethod(item);
          if (theMethod) {
            theClass.methods.push(theMethod);
          }
        }
      });
    }
  }
  return theClass;
}

function getDocumenationObject(sourceCode) {
  try {
    let comments = [];
    let ast = AcornObj.parse.parse(sourceCode, {
      onComment: comments,
    });

    let toDocument = getTopLevelNodes(ast);

    let klassesToDoc = toDocument.cls;
    let klassDocs = [];
    let fnsToDoc = toDocument.funcs;
    let fnDocs = [];

    let klassCount = 0,
      fnCount = 0;
    comments.forEach((comment) => {
      let commentObj = parseComment(comment.value);
      if (commentObj.type === "@class") {
        let klass = klassesToDoc[klassCount];
        if (klass) {
          klassDocs.push({
            comment: commentObj,
            doc: documentClass(klass),
          });
        }

        klassCount++;
      } else if (commentObj.type === "@function") {
        let fn = fnsToDoc[fnCount];
        if (fn) {
          fnDocs.push({
            comment: commentObj,
            doc: {},
          });
        }
        fnCount++;
      }
    });

    return {
      cls: klassDocs,
      fns: fnDocs,
    }; //TO -> HTML
  } catch (e) {
    console.error(e);
  }
  return null;
}

/** @function
 * documents a class
 * @param sourceFilePath
 */
let documentFile = function (sourceFilePath) {
  const source = FS.readFileSync(sourceFilePath, "utf8");
  let doc = getDocumenationObject(source);
  if (doc) {
    console.log(JSON.stringify(doc));
    //TO HTML
  }
};

module.exports.documentFile = documentFile;

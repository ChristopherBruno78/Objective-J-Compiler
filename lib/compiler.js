"use strict";

const acorn = require("acorn"),
  acornObjj = require("acorn-objj"),
  exceptions = require("./exceptions.js"),
  formats = require("./formats.js"),
  globals = require("./globals.js"),
  indentation = require("./indentation.js"),
  language = require("./language.js"),
  NullBuffer = require("./nullbuffer.js"),
  path = require("path"),
  Scope = require("./scope.js"),
  StringBuffer = require("./stringbuffer.js"),
  util = require("util"),
  utils = require("./utils.js");

class MisspelledSymbolMap {
  constructor(map) {
    this.map = new Map();
    // istanbul ignore else
    if (map) {
      for (const key of map.keys()) this.add(key);
    }
  }

  add(key) {
    this.map.set(key.toLocaleLowerCase(), key);
  }

  get(key) {
    return this.map.get(key.toLocaleLowerCase());
  }
}

const // jscs: ignore requireMultipleVarDecl
  indenter = indentation.indenter,
  indentString = indentation.indentString,
  ClassDef = language.ClassDef,
  MethodDef = language.MethodDef,
  entityTypes = {
    ENTITY_TYPE_VAR: 0,
    ENTITY_TYPE_FUNCTION: 1,
    ENTITY_TYPE_METHOD: 2,
  },
  entityTypeDescriptions = new Map([
    [entityTypes.ENTITY_TYPE_VAR, "local declaration of"],
    [entityTypes.ENTITY_TYPE_FUNCTION, "function parameter"],
    [entityTypes.ENTITY_TYPE_METHOD, "method parameter"],
  ]),
  typeStatements = new Set([
    "objj_ClassStatement",
    "objj_GlobalStatement",
    "objj_TypeDefStatement",
  ]),
  predefinedTypes = new Set([
    "BOOL",
    "byte",
    "char",
    "double",
    "float",
    "id",
    "int",
    "instancetype",
    "JSObject",
    "long",
    "SEL",
    "short",
    "signed",
    "unsigned",
    "CPInteger",
    "CPTimeInterval",
    "CPUInteger",
  ]),
  misspelledTypes = new MisspelledSymbolMap(predefinedTypes),
  // Instance variables we save/restore when importing
  importStateVars = [
    "AST",
    "source",
    "sourcePath",
    "objjScope",
    "jsBuffer",
    "BufferClass",
    "lastNode",
  ],
  isLogicalOrBinaryExpression = acornObjj.utils.makeKeywordRegexp(
    "LogicalExpression BinaryExpression"
  );

// acorn (parser) options. For more information see acorn-objj.
// Options may be passed to further configure the compiler.
// istanbul ignore next: no need to cover the functions here
exports.defaultOptions = {
  // We use a function here to create a new object every time we copy the default options.
  acornOptions() {
    return Object.create(null);
  },

  // If true, generates a source map for the compiled file.
  sourceMap: false,

  // A URL to the root directory of the source files, used by the source map.
  sourceRoot: ".",

  // Pass in class definitions. New class definitions in the source file will be added to this when compiling.
  classDefs() {
    return new Map();
  },

  // Pass in protocol definitions. New protocol definitions in the source file will be added to this when compiling.
  protocolDefs() {
    return new Map();
  },

  // Pass in typedef definitions. New typedef definitions in the source file will be added to this when compiling.
  typedefs() {
    return new Map();
  },

  // The compiler uses JSON format objects which determine how the source code is formatted.
  // Example formats are located in the formats directory.
  format: "cappuccino",

  // The string to use to indent. Defaults to a single space.
  indentString: " ",

  // How many indentStrings to use when indenting generated code.
  indentWidth: 4,

  // If true, comments are included when generating code and the acorn options
  // trackComments and trackCommentsIncludeLineBreak are set true.
  includeComments: true,

  // The environment in which the code is expected to run.
  // This determines the set of predefined globals.
  environment: "browser",

  // The maximum number of errors that can occur before compilation is aborted.
  maxErrors: 20,

  // Objective-J methods are implemented as functions. If this option is true, the functions
  // are named $<class>_<method>, where <class> is the class name, and <method> is the method name
  // with ':' in the selector replaced with '_'. If this option is false, the function is anonymous.
  methodNames: true,

  // If true, the compiler generates type information for method return types/parameters and ivars.
  typeSignatures: true,

  // Supported optional compiler warnings and their default values.
  warnings: {
    debugger: true,
    "shadowed-vars": true,
    "implicit-globals": true,
    "unknown-identifiers": false,
    "parameter-types": false,
    "unknown-types": false,
    "unimplemented-protocol-methods": true,
  },
};

const operatorPrecedence = {
    // MemberExpression
    // These two are never used, since the "computed" attribute of the MemberExpression
    // determines which one to use.
    // ".": 0, "[]": 0,

    // NewExpression
    // This is never used.
    // "new": 1,

    // All these are UnaryExpression or UpdateExpression and are never used.
    // "!": 2, "~": 2, "-": 2, "+": 2, "++": 2, "--": 2, "typeof": 2, "void": 2, "delete": 2,

    // BinaryExpression
    "*": 3,
    "/": 3,
    "%": 3,
    "+": 4,
    "-": 4,
    "<<": 5,
    ">>": 5,
    ">>>": 5,
    "<": 6,
    "<=": 6,
    ">": 6,
    ">=": 6,
    in: 6,
    instanceof: 6,
    "==": 7,
    "!=": 7,
    "===": 7,
    "!==": 7,
    "&": 8,
    "^": 9,
    "|": 10,

    // LogicalExpression
    "&&": 11,
    "||": 12,

    // ConditionalExpression
    // AssignmentExpression
  },
  expressionTypePrecedence = {
    MemberExpression: 0,
    CallExpression: 1,
    NewExpression: 2,
    FunctionExpression: 3,
    UnaryExpression: 4,
    UpdateExpression: 4,
    BinaryExpression: 5,
    LogicalExpression: 6,
    ConditionalExpression: 7,
    AssignmentExpression: 8,
  },
  varTypes = {
    "global var": "a global",
    "@global": "a global",
    "implicit global": "an implicitly declared global",
    "@class": "a class",
    "file var": "a file variable",
    "local var": "a variable in a containing closure",
    "function parameter": "a function parameter",
    "method parameter": "a method parameter",
  };

class Compiler {
  constructor(source, sourcePath, ast, issues, options) {
    this.source = source;
    this.sourcePath = sourcePath;
    this.AST = ast;
    this.issues = issues;
    this.options = options;
    this.objjScope = this.options.objjScope;
    this.classDefs = options.classDefs;
    this.superclassRefs = [];
    this.misspelledClasses = new MisspelledSymbolMap(this.classDefs);
    this.protocolDefs = options.protocolDefs;
    this.misspelledProtocols = new MisspelledSymbolMap(this.protocolDefs);
    this.typedefs = options.typedefs;
    this.misspelledTypedefs = new MisspelledSymbolMap(this.typedefs);
    this.dependencies = [];
    this.sourceFiles = new Map([[sourcePath, source]]);
    this.jsBuffer = new StringBuffer(this);
    this.BufferClass = StringBuffer;
    this.instanceMethods = null;
    this.classMethods = null;
    this.compiledCode = null;
    this.destPath = this.getDestPath(sourcePath);
    this.format =
      typeof options.format === "string"
        ? formats.load(options.format)
        : /* istanbul ignore next: I'm too lazy to test this */ options.format;
    this.nodeCompiler = this.compileNode.bind(this);
    this.initPredefinedGlobals();
  }

  initPredefinedGlobals() {
    this.predefinedGlobals = Object.create(null);
    Object.assign(
      this.predefinedGlobals,
      globals.reserved,
      globals.nonstandard,
      globals.ecmaIdentifiers,
      globals.newEcmaIdentifiers,
      globals[this.options.environment]
    );

    if (this.options.environment === "browser")
      Object.assign(this.predefinedGlobals, globals.devel);
  }

  get issueCount() {
    return this.issues.length;
  }

  /**
   * Called when an implicit global is created by assignment. It tries to find a previous
   * var statement if there is this kind of mistake:
   *
   * var a = 7,
   *     b = 13; <- this should be a comma
   *     c = 27,
   *     d = 31,
   *     e;
   *
   * If no such var statement can be found, null is returned.
   *
   * @param {acorn.Node} identifierNode - Identifier that is a target of an assignment.
   * @returns {acorn.Node|null} - See the description above.
   */
  static findPreviousVarDeclaration(identifierNode) {
    let statement = Scope.previousStatement(identifierNode);

    // If this is the first statement of a parent, statement will be null.
    // In that case there is no hint we can offer.
    if (!statement) return null;

    // At this point statement should be an ExpressionStatement.
    // If its expression is an AssignmentExpression or SequenceExpression,
    // then this might be an orphaned section of a preceding variable declaration.
    const type = statement.expression.type;

    if (type === "AssignmentExpression" || type === "SequenceExpression") {
      // Get the previous statement. If that's a variable declaration, return it.
      statement = Scope.previousStatement(statement);

      if (statement && statement.type === "VariableDeclaration")
        return statement;
    }

    return null;
  }

  // Returns true if subnode has higher precedence than node.
  // If subnode is the right subnode of a binary expression, right is true.
  static subnodeHasPrecedence(node, subnode, right) {
    const nodeType = node.type,
      nodePrecedence = expressionTypePrecedence[nodeType] || -1,
      subnodePrecedence = expressionTypePrecedence[subnode.type] || -1;

    if (subnodePrecedence > nodePrecedence) return true;

    if (
      nodePrecedence === subnodePrecedence &&
      isLogicalOrBinaryExpression.test(nodeType)
    ) {
      const subnodeOperatorPrecedence = operatorPrecedence[subnode.operator],
        nodeOperatorPrecedence = operatorPrecedence[node.operator];

      return (
        subnodeOperatorPrecedence > nodeOperatorPrecedence ||
        (right === true && nodeOperatorPrecedence === subnodeOperatorPrecedence)
      );
    }

    return false;
  }

  static accessorAttributes(accessors) {
    let attributes = [];

    if (accessors.readonly) attributes.push("readonly");
    else if (accessors.copy) attributes.push("copy");

    if (accessors.property)
      attributes.push(`property=${accessors.property.name}`);

    if (accessors.getter) attributes.push(`getter=${accessors.getter.name}`);

    if (accessors.setter)
      // Strip trailing ':'
      attributes.push(
        `setter=${accessors.setter.name.replace(/(.+):$/, "$1")}`
      );

    if (attributes.length) return "(" + attributes.join(", ") + ")";

    return "";
  }

  checkTypeProtocols(protocols) {
    if (!protocols) return;

    for (const protocol of protocols) {
      if (!this.getProtocolDef(protocol.name))
        this.unknownProtocolException(protocol, true);
    }
  }

  /*
        Helper for code_generator.objjMethodDeclaration

        objj (for methods):

        selectors: Array - Identifier nodes, one for each element in params
        params: Array - Objects with these keys/values:
            type: objj_ObjectiveJType node
            id: Identifier node
    */
  makeSelector(
    scope,
    compileNode,
    params,
    types,
    selectors // -> selector
  ) {
    let selector = selectors[0].name;

    for (let i = 0; i < params.length; i++) {
      const param = params[i],
        paramType = param.type,
        objj = paramType ? paramType.objj : null,
        protocols = objj ? objj.protocols : null;

      types.push(paramType ? objj.name : "id");

      if (i === 0) selector += ":";
      else selector += (selectors[i] ? selectors[i].name : "") + ":";

      this.checkTypeProtocols(protocols);
    }

    return selector;
  }

  static generateGetter(
    classDef,
    accessors,
    properties,
    node,
    ivarName,
    ivarType
  ) {
    const selector = this.makeAccessorSelector(accessors, "getter", ivarName);

    if (classDef.getOwnInstanceMethod(selector)) return "";

    classDef.addInstanceMethod(new MethodDef(node, selector, [ivarType]));

    const code = `
// ${ivarName} @accessors${properties} [getter]
// - (${ivarType})${selector}
new objj_method(sel_getUid("${selector}"),
function $${classDef.name}__${selector}(self, _cmd)
{
→return self.${ivarName};
},
// argument types
["${ivarType}"])`;

    return indentString(code);
  }

  addIssue(Class) {
    const args = [].slice.call(arguments, 1);

    return this._addIssue(this.issues.addIssue, Class, ...args);
  }

  addNote() {
    return this._addIssue(this.issues.addNote, null, ...arguments);
  }

  addWarning() {
    return this._addIssue(this.issues.addWarning, null, ...arguments);
  }

  addError() {
    const issue = this._addIssue(this.issues.addError, null, ...arguments);

    if (
      this.options.maxErrors > 0 &&
      this.issues.errorCount > this.options.maxErrors
    )
      throw new exceptions.TooManyErrors(this.options.maxErrors);

    return issue;
  }

  getDestPath(sourceFile) {
    let destPath;

    if (this.options.output) {
      const outputPath = path.resolve(this.options.output);

      if (this.options.useStdin) sourceFile = outputPath;

      const baseFilename = path.basename(sourceFile, path.extname(sourceFile));

      if (this.options.useStdin)
        destPath = path.join(path.dirname(outputPath), baseFilename);
      else destPath = path.join(outputPath, baseFilename);

      destPath += ".oj";
    } else
      destPath = path.basename(sourceFile, path.extname(sourceFile)) + ".oj";

    return destPath;
  }

  get errorCount() {
    return this.issues.errorCount;
  }

  getIvarForCurrentClass(ivarName, scope) {
    const method = scope.currentObjjMethodScope();

    if (method) {
      let classDef = this.getClassDef(scope.currentClassName());

      while (classDef) {
        const ivarDef = classDef.getIvar(ivarName);

        if (ivarDef) return ivarDef;

        classDef = classDef.superclassDef;
      }
    }

    return null;
  }

  getClassDef(name) {
    return this.classDefs.get(name) || null;
  }

  addClassDef(name, def) {
    if (def.category) name += "+" + def.category;

    this.classDefs.set(name, def);
    this.misspelledClasses.add(name);
  }

  getProtocolDef(name) {
    return this.protocolDefs.get(name) || null;
  }

  addProtocolDef(name, def) {
    this.protocolDefs.set(name, def);
    this.misspelledProtocols.add(name);
  }

  // Helper for code_generator.objjClassDeclaration
  checkProtocolConformance(node, classDef, protocols) {
    if (!this.shouldWarnAbout("unimplemented-protocol-methods")) return;

    for (const protocol of protocols) {
      const protocolDef = this.getProtocolDef(protocol.name);

      if (!protocolDef) continue;

      const unimplementedMethods = classDef.unimplementedMethodsForProtocol(
        protocolDef
      );

      if (unimplementedMethods.length === 0) continue;

      for (const entry of unimplementedMethods) {
        const methodDef = entry.method;

        this.addWarning(
          protocol,
          "method '%s' in protocol '%s' not implemented",
          methodDef.name,
          entry.protocolName
        );

        this.addNote(
          methodDef.node,
          "method '%s' declared here",
          methodDef.name
        );
      }
    }
  }

  static findIvar(
    name,
    classDef // -> { ivar: node, className: String }
  ) {
    while (true) {
      const ivar = classDef.getIvar(name);

      if (ivar)
        return { ivar: ivar.node, className: classDef.node.objj.name.name };

      classDef = classDef.superclassDef;

      if (!classDef) return null;
    }
  }

  // Only called for non-predefined Objective-J types (node.objj.isClass)
  checkForUnknownType(node, type) {
    if (
      !this.getClassDef(type) &&
      !this.getProtocolDef(type) &&
      !this.getTypeDef(type) &&
      !predefinedTypes.has(type)
    ) {
      let message = `unknown type '${type}'`;

      const possibleName = this.findMisspelledName(type);

      if (possibleName) message += `; did you mean '${possibleName}'?`;

      this.addWarning(node, message);
    }
  }

  addTypeDef(typedef) {
    this.typedefs.set(typedef.name, typedef);
    this.misspelledTypedefs.add(typedef.name);
  }

  getTypeDef(/* String */ name) {
    return this.typedefs.get(name) || null;
  }

  static makeAccessorSelector(accessors, type, ivarName) {
    let selector;

    if (accessors[type])
      selector = accessors[type].name.replace(/(.+):$/, "$1");
    // strip trailing ':'
    else if (accessors.property) selector = accessors.property.name;
    else if (ivarName.charAt(0) === "_") selector = ivarName.substring(1);
    else selector = ivarName;

    if (type === "setter") {
      // If no "setter" property was specified, synthesize the setter selector
      if (!accessors[type])
        selector = `set${selector.charAt(0).toUpperCase()}${selector.substr(
          1
        )}`;

      selector += ":";
    }

    return selector;
  }

  duplicateDefinitionException(
    definitionType,
    name,
    warn,
    originalNode,
    duplicateNode
  ) {
    if (warn) {
      if (!this.options.ignoreWarnings) {
        this.addWarning(
          duplicateNode,
          "duplicate %s definition '%s' is ignored",
          definitionType,
          name
        );

        if (originalNode)
          this.addNote(originalNode, "previous definition is here");
      }
    } else {
      this.addError(
        duplicateNode,
        "duplicate definition of %s '%s'",
        definitionType,
        name
      );

      // istanbul ignore else: currently always using originalNode, but that could change
      if (originalNode)
        this.addNote(originalNode, "previous definition is here");
    }

    return false;
  }

  unknownProtocolException(node, isWarning) {
    let message = "cannot find protocol declaration for '%s'";
    const possibleName = this.misspelledProtocols.get(node.name);

    if (possibleName) message += `; did you mean '${possibleName}'?`;

    this[isWarning ? "addWarning" : "addError"](node, message, node.name);
  }

  /*
        This is only called in assignments or references in expressions, not for declared variables.
        Checks for the following conditions:

        - Assigning to a read-only predefined global
        - Implicitly creating a global var (via assignment) in a local scope
        - Referencing an unknown identifier as an rvalue
    */
  checkIdentifierReference(node, scope) {
    if (scope.assignment === "=") this.checkAssignment(node, scope);
    else this.checkForUnknownIdentifier(node, scope);
  }

  checkAssignment(node, scope) {
    // Assignments to properties are not checked
    if (scope.isMemberParent) return;

    const identifier = node.name;
    let variable = this.getPredefinedGlobal(identifier);

    if (variable) {
      if (!variable.writable)
        this.addWarning(node, "assigning to a read-only predefined global");
    } else {
      // We need to know if this identifier is an implicit global
      // which is created by assigning to an identifier within a
      // local var scope.

      // First check to see if the identifier is known.
      variable = scope.getVar(identifier);

      // If it isn't a known variable, see if it's a known global symbol.
      // If so, we're done.
      if (!variable && !this.isUniqueGlobalSymbol(node, scope, node)) return;

      // If we are in a local var scope and it isn't known, or if it's
      // an implicit global from a different scope, warn the user.
      const isLocalScope = scope.isLocalVarScope();
      let implicitGlobal =
        isLocalScope &&
        (!variable ||
          (variable.type === "implicit global" && variable.scope !== scope));

      if (implicitGlobal && this.shouldWarnAbout("implicit-globals")) {
        let message = util.format(
          "implicitly creating the global variable '%s' in the %s '%s'",
          identifier,
          // The local var scope could be a method or function
          scope.functionName ? "function" : "method",
          scope.selector || scope.functionName
        );

        const varDeclaration = this.constructor.findPreviousVarDeclaration(
          node
        );

        if (!varDeclaration)
          message += util.format("; did you mean to use 'var %s'?", identifier);

        this.addIssue(exceptions.ImplicitGlobalWarning, node, message);

        if (varDeclaration) {
          /*
                        Construct a dummy node that has sufficient information
                        for the Issue class and for identifier issue filtering.
                        We want it to point to the end of the var declaration
                        and refer to the identifier being assigned to.
                    */
          const noteNode = {
            start: varDeclaration.end - 1,
            end: varDeclaration.end,
            name: identifier,
            sourceFile: varDeclaration.sourceFile,
          };
          this.addIssue(
            exceptions.ImplicitGlobalNote,
            noteNode,
            "did you mean to use a comma here?"
          );
        }
      }

      scope.rootScope().vars.set(identifier, {
        type: implicitGlobal ? "implicit global" : "global var",
        node,
        implicit: implicitGlobal,
        scope, // record the scope
      });
    }
  }

  findMisspelledName(name) {
    return (
      this.misspelledClasses.get(name) ||
      this.misspelledProtocols.get(name) ||
      this.misspelledTypedefs.get(name) ||
      misspelledTypes.get(name)
    );
  }

  checkForUnknownIdentifier(node, scope) {
    if (!scope.assignment && !this.shouldWarnAbout("unknown-identifiers"))
      return;

    const identifier = node.name;

    if (
      scope.getVar(identifier) === null &&
      this.getClassDef(identifier) === null &&
      this.getProtocolDef(identifier) === null &&
      this.getTypeDef(identifier) === null &&
      !this.isPredefinedGlobal(identifier)
    ) {
      let message = "reference to unknown identifier '%s'";

      // It could be a misspelled class/protocol name
      if (scope.receiver) {
        const name = this.findMisspelledName(identifier);

        if (name) message += "; did you mean '" + name + "'?";
      }

      this.addIssue(
        exceptions.UnknownIdentifierWarning,
        node,
        message,
        identifier
      );
    }
  }

  // Called for var declarations and function/method parameters
  checkForShadowedVars(node, scope, entityType) {
    const identifier = node.name;

    if (!this.shouldWarnAbout("shadowed-vars")) return;

    let def = scope.getVar(identifier),
      shadowedType,
      shadowedNode;

    if (def) {
      shadowedType = varTypes[def.type];

      // If the var is an implicit global in the same scope,
      // it means a local var declaration was made after assignment,
      // which is legal in Javascript. So we convert the original global
      // to a local.
      if (def.type === "implicit global" && def.scope === scope) {
        def.type = "local var";
        delete def.implicit;
        shadowedType = null;

        // When the original assignment was made, the var vas added
        // to the root scope as a global. It no longer is global.
        scope.rootScope().vars.delete(identifier);
      } else shadowedNode = def.node;
    }

    if (!shadowedType) {
      def = this.getClassDef(identifier);

      if (def) {
        shadowedType = "a class";
        shadowedNode = def.node;
      }
    }

    if (!shadowedType) {
      def = this.getProtocolDef(identifier);

      if (def) {
        shadowedType = "a protocol";
        shadowedNode = def.node;
      }
    }

    if (!shadowedType) {
      def = this.getTypeDef(identifier);

      if (def) {
        shadowedType = "a typedef";
        shadowedNode = def.node;
      }
    }

    if (!shadowedType) {
      def = this.getPredefinedGlobal(identifier);

      if (def && !def.ignoreShadow) shadowedType = "a predefined global";
    }

    if (!shadowedType) {
      const ivar = this.getIvarForCurrentClass(identifier, scope);

      if (ivar) {
        shadowedType = "an instance variable";
        shadowedNode = ivar.node;

        /*
                    Now we have to deal with a case like this:

                    @implementation Test
                    {
                        int one;
                        int two;
                    }

                    - (void)test
                    {
                        one = 7;

                        var one;
                    }
                    @end

                    In this case, the first reference to 'one' in the 'test' method
                    will be treated as an ivar reference. But when the same name is
                    declared as a var later, we have to convert the ivar reference
                    to a regular variable identifier and issue a warning that the reference
                    hides an ivar.
                */

        const ivarRefs = scope.getIvarRefs(identifier);

        if (ivarRefs) {
          for (const ivarInfo of ivarRefs) {
            this.jsBuffer.remove(ivarInfo.index);

            this.addWarning(
              ivarInfo.node,
              "reference to local variable '%s' hides an instance variable",
              identifier
            );
          }

          scope.ivarRefs.delete(identifier);
        }
      }
    }

    if (shadowedType) {
      this.addWarning(
        node,
        "%s '%s' hides %s",
        entityTypeDescriptions.get(entityType),
        identifier,
        shadowedType
      );

      if (shadowedNode)
        this.addNote(shadowedNode, "hidden declaration is here");
    }
  }

  createClass(node, name, superclassNode, category) {
    // To be an @implementation declaration it must have method and ivar dictionaries.
    // Otherwise it's a @class declaration.

    if (superclassNode) {
      this.superclassRefs.push({
        superclass: superclassNode.name,
        class: name,
      });
    }

    return new ClassDef(node, name, superclassNode, null, category);
  }

  _addIssue(method, Class, node, message) {
    const args = Array.prototype.slice.call(arguments, 4),
      source = this.source;

    let issue;

    if (Class)
      issue = method.call(
        this.issues,
        Class,
        source,
        this.sourcePath,
        node,
        message,
        ...args
      );
    else
      issue = method.call(
        this.issues,
        source,
        this.sourcePath,
        node,
        message,
        ...args
      );

    issue.node = utils.copyNode(node);

    return issue;
  }

  /*
        When a global symbol declaration is made, make sure it is not a duplicate
        of the same type of symbol, that it has not already been made for a
        different type of symbol (except for @implementation/@protocol),
        or that it is superfluous.

        Possible symbol types:

        @class
        @global
        @typedef
        global variables
        predefined global variables
        @implementation
        @implementation with category
        @protocol
    */
  isUniqueGlobalSymbol(node, scope, identifierNode) {
    const objj = node.objj,
      name = identifierNode.name;

    let problem = "previously defined as",
      previousType,
      previousNode,
      def;

    /*
            First check classes (@implementation). There are several possibilities
            we have to deal with:

            1. Category already declared with the same name: duplicate error.
            2. Category has no matching declared class: error.
            3. @implementation already declared with the same name: duplicate error.
            4. @implementation already declared with @class: allow the @implementation
               to replace the @class.
            5. @implementation declared with the same name as a @protocol: no error.
            6. @implementation already declared as any other symbol type: error.
        */
    if (node.type === "objj_ClassDeclaration") {
      def = this.getClassDef(name);

      if (objj.category) {
        if (def) {
          const category = objj.category.name,
            categoryDef = this.getClassDef(name + "+" + category);

          // Case #1
          if (categoryDef) {
            return this.duplicateDefinitionException(
              "category",
              `${name} (${category})`,
              false,
              categoryDef.node,
              node
            );
          }

          // If we get here, it's what we expect: a category with already declared class
          return true;
        }

        // Case #2
        this.addError(
          node,
          "cannot find implementation declaration for '%s'",
          name
        );

        return false;
      } else if (def) {
        // def could be @implementation or @class
        // Case #3
        if (def.node.type === "objj_ClassDeclaration")
          return this.duplicateDefinitionException(
            "class",
            name,
            false,
            def.node,
            node
          );

        // Case #4: If node is an @implementation and def is a @class,
        // warn but return true to pretend the @implementation is unique
        // so it can replace the @class.
        if (!this.options.ignoreWarnings) {
          this.addWarning(
            def.node,
            "@class definition '%s' is unnecessary",
            name
          );
          this.addNote(node, "superceded by this definition");
        }

        return true;
      }
    } else {
      // node is not an @implementation or category, see if the name is already defined
      // as a protocol or class. It's legal to have a protocol and class with the same name.
      def = this.getClassDef(name);

      if (def) {
        if (node.type === "objj_ProtocolDeclaration") return true;

        if (node.type === "objj_ClassStatement")
          return this.duplicateDefinitionException(
            "class",
            name,
            true,
            def.node,
            identifierNode
          );

        previousNode = def.node;
        previousType = "a class";
      }
    }

    if (!previousType) {
      def = this.getProtocolDef(name);

      if (def) {
        // It's legal to have a protocol and class with the same name
        if (node.type === "objj_ClassDeclaration") return true;

        if (node.type === "objj_ProtocolDeclaration")
          return this.duplicateDefinitionException(
            "protocol",
            name,
            true,
            def.node,
            node
          );

        previousNode = def.node;
        previousType = "a protocol";
      }
    }

    if (!previousType) {
      def = scope.getGlobalVar(name);

      if (def) {
        if (node.type === "objj_GlobalStatement")
          return this.duplicateDefinitionException(
            "global",
            name,
            true,
            def.node,
            identifierNode
          );

        previousNode = def.node;
        previousType = "a global";
      }
    }

    if (!previousType) {
      def = this.getTypeDef(name);

      if (def) {
        if (node.type === "objj_TypeDefStatement")
          return this.duplicateDefinitionException(
            "typedef",
            name,
            true,
            def.node,
            identifierNode
          );

        previousNode = def.node;
        previousType = "a typedef";
      }
    }

    if (!previousType) {
      def = this.getPredefinedGlobal(name);

      if (def) {
        if (node.type === "objj_GlobalStatement")
          return this.duplicateDefinitionException(
            "predefined global",
            name,
            true,
            null,
            identifierNode
          );

        previousType = "a predefined global";
        problem = "is";
      }
    }

    if (previousType) {
      if (typeStatements.has(node.type)) node = identifierNode;

      this.addError(node, `'${name}' ${problem} ${previousType}`);

      if (previousNode) this.addNote(previousNode, "definition is here");

      return false;
    }

    return true;
  }

  /*
        Helper for code_generator.objjClassDeclaration

        objj:

        isOutlet: boolean - Whether the ivar is an IB outlet
        type: objj_ObjectiveJType node - The ivar's type
        id: Identifier node - The ivar's name
        accessors: Object - Keys are accessor attribute names, values are:
            property, getter, setter - Identifier node
            readwrite, readonly, copy - true
    */
  generateAccessors(
    node,
    classDef // -> accessors
  ) {
    const ivars = node.objj.ivars;

    indenter.indent();

    for (let i = 0; i < ivars.length; i++) {
      const ivar = ivars[i].objj,
        accessors = ivar.accessors;

      if (!accessors) continue;

      const ivarType = ivar.type.objj.name,
        ivarName = ivar.id.name;

      let attributes = this.constructor.accessorAttributes(accessors),
        code = this.constructor.generateGetter(
          classDef,
          accessors,
          attributes,
          node,
          ivarName,
          ivarType
        );

      if (code) {
        if (this.instanceMethods.length) this.instanceMethods.concat(",\n");

        this.instanceMethods.concat(code);
      }

      if (accessors.readonly) {
        if (accessors.setter) {
          this.addError(
            accessors.setter,
            "setter cannot be specified for a readonly ivar"
          );
        }

        continue;
      }

      code = this.generateSetter(
        classDef,
        accessors,
        attributes,
        node,
        ivarName,
        ivarType
      );

      if (code) {
        // When we get here, there will always be at least a getter method in this.instanceMethods,
        // so will always prepend a comma.
        this.instanceMethods.concat(",\n" + code);
      }
    }

    indenter.dedent();
  }

  generateSetter(classDef, accessors, properties, node, ivarName, ivarType) {
    let selector = this.constructor.makeAccessorSelector(
      accessors,
      "setter",
      ivarName
    );

    if (classDef.getOwnInstanceMethod(selector)) return "";

    classDef.addInstanceMethod(
      new MethodDef(node, selector, ["void", ivarType])
    );

    let setterCode;

    if (accessors.copy) {
      let messageSend;

      if (this.options.inlineMsgSend)
        messageSend = `(newValue.isa.method_msgSend["${selector}"] || _objj_forward)`;
      else messageSend = "newValue.isa.objj_msgSend0";

      // First line is indented by template below
      setterCode = `if (self.${ivarName} !== newValue)
→→/* ${ivarName} = [newValue copy] */ self.${ivarName} = newValue == null ? null : ${messageSend}(newValue, "copy");`;
    } else setterCode = "self." + ivarName + " = newValue;";

    const definition = `
// ${ivarName} @accessors${properties} [setter]
// - (void)${selector}(${ivarType})newValue
new objj_method(sel_getUid("${selector}"),
function $${classDef.name}__${selector.slice(0, -1)}_(self, _cmd, newValue)
{
→${setterCode}
},
// argument types
["void", "${ivarType}"])`;

    return indentString(definition);
  }

  // If an ivar has a readonly @accessor, the class may not define

  // an instance set method for that property
  checkForSetterConflicts(node, scope, selector) {
    if (
      !scope.classDef ||
      node.objj.methodType !== "-" ||
      !selector.startsWith("set")
    )
      return;

    const ivars = scope.classDef.ivars;

    for (const entry of ivars) {
      const ivar = entry[1];

      if (!ivar.accessors || !ivar.accessors.readonly) continue;

      // If the accessors specifies a custom setter name, use that
      let name = entry[0],
        setter;

      if (ivar.accessors.property) name = ivar.accessors.property.name;
      else if (ivar.accessors.setter) setter = ivar.accessors.setter.name;

      if (!setter)
        setter = "set" + name.charAt(0).toUpperCase() + name.substr(1) + ":";

      if (setter === selector) {
        this.addError(
          node,
          "setter method '%s' cannot be defined for the readonly ivar '%s'",
          selector,
          entry[0]
        );

        this.addNote(ivar.node, "ivar declaration is here");
      }
    }
  }

  get code() {
    // istanbul ignore else: no point in testing that
    if (this.compiledCode === null) {
      this.compiledCode = this.jsBuffer.toString();

      // Be sure to terminate with EOL
      // istanbul ignore next: no need to test
      if (this.compiledCode.charAt(this.compiledCode.length - 1) !== "\n")
        this.compiledCode += "\n";

      if (this.options.sourceMap) {
        // We always write the source map next to the generated source,
        // so the sourceMappingURL is just the dest path + ".map".
        const sourceMapPath = path.basename(this.destPath) + ".map";

        this.compiledCode += `//# sourceMappingURL=${encodeURI(
          sourceMapPath
        )}\n`;
      }
    }

    return this.compiledCode;
  }

  get sourceMap() {
    return this.jsBuffer.sourceMap;
  }

  /**
   * @param {String} identifier - Name of the global to lookup.
   * @returns {null|{writable:boolean, ignoreShadow:boolean}} - Properties of the global if found, otherwise null.
   */
  getPredefinedGlobal(identifier) {
    const info = this.predefinedGlobals[identifier];

    if (info === undefined) return null;

    if (typeof info === "boolean")
      return { writable: info, ignoreShadow: false };

    return info;
  }

  isPredefinedGlobal(identifier) {
    return identifier in this.predefinedGlobals;
  }

  shouldWarnAbout(warning) {
    return !this.options.ignoreWarnings && this.options.warnings[warning];
  }

  filterIdentifierIssues(scope) {
    this.issues.filter((issue) => {
      if (issue.filterable && issue.scope === scope)
        return !issue.isValidInScope(scope);

      return true;
    });
  }

  compileNode(node, scope, virtualType) {
    const buffer = this.jsBuffer,
      lastNode = this.lastNode,
      sameNode = lastNode === node;

    this.lastNode = node;

    if (!sameNode) {
      scope.constructor.pushNode(node);
      buffer.concatFormat(node, scope, "before");
    }

    this.codeGenerator[virtualType || node.type](
      node,
      scope,
      this.nodeCompiler
    );

    if (!sameNode) {
      buffer.concatFormat(node, scope, "after");
      scope.constructor.popNode(node);
    }
  }

  compileWithFormat(visitor) {
    this.codeGenerator = visitor;

    const globalScope = new Scope(Scope.Type.GLOBAL, null, { compiler: this });

    this.compileNode(this.AST, globalScope);
  }
}

exports.Compiler = Compiler;
exports.entityTypes = entityTypes;

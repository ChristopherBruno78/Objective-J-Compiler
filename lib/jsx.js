const indentation = require("./indentation.js"),
      indenter = indentation.indenter;


exports.JSXAttribute = function(node, scope, compileNode) {
    const buffer = scope.compiler.jsBuffer;
    compileNode(node.name, scope);
    if (node.value) {
        buffer.concat("=");
        compileNode(node.value, scope);
    }
};

exports.JSXIdentifier = function(node, scope) {
    scope.compiler.jsBuffer.concat(node.name);
};

exports.JSXNamespacedName = function(node, scope, compileNode) {
    compileNode(node.namespace, scope);
    scope.compiler.jsBuffer.concat(":");
    compileNode(node.name, scope);
};

exports.JSXMemberExpression = function(node, scope, compileNode) {
    compileNode(node.object, scope);
    scope.compiler.jsBuffer.concat(".");
    compileNode(node.property, scope);
};

exports.JSXSpreadAttribute = function(node, scope, compileNode) {
    const buffer = scope.compiler.jsBuffer;

    buffer.concat("{");
    buffer.concat("...");
    compileNode(node.argument, scope);
    buffer.concat("}");
};

exports.JSXExpressionContainer = function(node, scope, compileNode) {
    const buffer = scope.compiler.jsBuffer;
    buffer.concat("{");
    compileNode(node.expression, scope);
    buffer.concat("}");
};

exports.JSXSpreadChild = function(node, scope, compileNode) {
    const buffer = scope.compiler.jsBuffer;
    buffer.concat("{");
    buffer.concat("...");
    compileNode(node.expression, scope);
    buffer.concat("}");
};

function getPossibleRaw(node) {
    const extra = node.extra;
    if (
        extra &&
        extra.raw != null &&
        extra.rawValue != null &&
        node.value === extra.rawValue
    ) {
        return extra.raw;
    }
}

exports.JSXText = function(node, scope, compileNode) {
    const raw = getPossibleRaw(node);

    const buffer = scope.compiler.jsBuffer;

    if (raw != null) {
        buffer.concat(raw);
    } else {
        buffer.concat(node.value);
    }
};

exports.JSXElement = function(node, scope, compileNode) {

    const open = node.openingElement;
    compileNode(open, scope);
    if (open.selfClosing) return;

    indenter.indent();
    for (const child of node.children) {
        compileNode(child, scope);
    }
    indenter.dedent();

    compileNode(node.closingElement, scope);
};

exports.JSXOpeningElement = function(node, scope, compileNode) {

    const buffer = scope.compiler.jsBuffer;
    buffer.concat("<");
    compileNode(node.name, scope);
    if (node.attributes.length > 0) {
        buffer.concat(" ");
        for(const attr of node.attributes) {
            compileNode(attr, scope);
            buffer.concat(" ");
        }
    }
    if (node.selfClosing) {
        buffer.concat(" ");
        buffer.concat("/>");
    } else {
        buffer.concat(">");
    }
};

exports.JSXClosingElement = function(node, scope, compileNode) {
    const buffer = scope.compiler.jsBuffer;
    buffer.concat("</");
    compileNode(node.name, scope);
    buffer.concat(">");
};

exports.JSXEmptyExpression = function(node, scope, compileNode) {
    //this.printInnerComments(node);
};

exports.JSXFragment = function(node, scope, compileNode) {
    compileNode(node.openingFragment, scope);

    indenter.indent();
    for (const child of node.children) {
        compileNode(child, scope);
    }
    indenter.dedent();

    compileNode(node.closingFragment, scope);
};

exports.JSXOpeningFragment = function(node, scope) {
    const buffer = scope.compiler.jsBuffer;
    buffer.concat("<");
    buffer.concat(">");
};

exports.JSXClosingFragment = function(node,scope) {
    const buffer = scope.compiler.jsBuffer;
    buffer.concat("</");
    buffer.concat(">");
};
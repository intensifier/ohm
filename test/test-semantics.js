'use strict';

// --------------------------------------------------------------------
// Imports
// --------------------------------------------------------------------

var extend = require('util-extend');
var fs = require('fs');
var test = require('tape');

var ohm = require('..');
var util = require('./util');

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

var arithmeticGrammarSource = fs.readFileSync('test/arithmetic.ohm').toString();

// Combines the properties of `obj1` and `props` into a new object.
function combine(obj1, props) {
  return extend(extend({}, obj1), props);
}

// --------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------

test('operations', function(t) {
  var expr = ohm.makeGrammar(arithmeticGrammarSource);
  var s = expr.semantics();

  function match(source) {
    return expr.match(source, 'expr');
  }

  // An operation that evaluates an expression
  s.addOperation('value', {
    addExpr_plus: function(x, op, y) {
      return x.value() + y.value();
    },
    mulExpr_times: function(x, op, y) {
      return x.value() * y.value();
    },
    number_rec: function(n, d) {
      return n.value() * 10 + d.value();
    },
    digit: function(expr) {
      return expr.value().charCodeAt(0) - '0'.charCodeAt(0);
    },
    _default: ohm.actions.passThrough,
    _terminal: function() {
      return this.node.primitiveValue;
    }
  });

  t.equal(s(match('1+2')).value(), 3, 'single addExpr');
  t.equal(s(match('13+10*2*3')).value(), 73, 'more complicated case');

  // An operation that produces a list of the values of all the numbers in the tree.
  s.addOperation('numberValues', {
    addExpr_plus: function(x, op, y) {
      return x.numberValues().concat(y.numberValues());
    },
    mulExpr_times: function(x, op, y) {
      return x.numberValues().concat(y.numberValues());
    },
    number: function(n) {
      return [n.value()];
    },
    _default: ohm.actions.passThrough
  });
  t.deepEqual(s(match('9')).numberValues(), [9]);
  t.deepEqual(s(match('13+10*2*3')).numberValues(), [13, 10, 2, 3]);

  t.end();
});

test('attributes', function(t) {
  var expr = ohm.makeGrammar(arithmeticGrammarSource);
  var count = 0;
  var s = expr.semantics().addAttribute('value', {
    addExpr_plus: function(x, op, y) {
      count++;
      return x.value + y.value;
    },
    mulExpr_times: function(x, op, y) {
      count++;
      return x.value * y.value;
    },
    number_rec: function(n, d) {
      count++;
      return n.value * 10 + d.value;
    },
    digit: function(expr) {
      count++;
      return expr.value.charCodeAt(0) - '0'.charCodeAt(0);
    },
    _default: ohm.actions.passThrough,
    _terminal: function() {
      count++;
      return this.node.primitiveValue;
    }
  });

  function match(source) {
    return expr.match(source, 'expr');
  }

  var simple = match('1+2');
  var complicated = match('13+10*2*3');

  t.equal(s(simple).value, 3, 'single addExpr');
  t.equal(s(complicated).value, 73, 'more complicated case');

  // Check that attributes are memoized
  var oldCount = count;
  t.deepEqual(s(simple).value, 3);
  t.deepEqual(s(complicated).value, 73);
  t.equal(count, oldCount);

  t.end();
});

test('semantics', function(t) {
  var expr = ohm.makeGrammar(arithmeticGrammarSource);
  var s = expr.semantics();

  t.equal(s.addOperation('op', {}), s, 'addOperation returns the receiver');
  t.equal(s.addAttribute('attr', {}), s, 'addAttribute returns the receiver');

  t.equal(s.addOperation('op2', {}), s, 'can add more than one operation');
  t.equal(s.addAttribute('attr2', {}), s, 'can add more than one attribute');

  t.throws(
    function() { s.addOperation('op'); },
    /already exists/,
    'addOperation throws when name is already used');
  t.throws(
    function() { s.addOperation('attr'); },
    /already exists/,
    'addOperation throws when name is already used, even if it is an attribute');

  t.throws(
    function() { s.addAttribute('attr'); },
    /already exists/,
    'addAttribute throws when name is already used');
  t.throws(
    function() { s.addAttribute('attr'); },
    /already exists/,
    'addAttribute throws when name is already used, even if it is an operation');

  t.throws(function() { s(null); }, /expected a node/);
  t.throws(function() { s(false); }, /expected a node/);
  t.throws(function() { s(); }, /expected a node/);
  t.throws(function() { s(3); }, /expected a node/);
  t.throws(function() { s('asdf'); }, /expected a node/);

  // Cannot use the semantics on nodes from another grammar...
  var g = ohm.makeGrammar('G {}');
  t.throws(function() { s(g.match('a', 'letter')); }, /Cannot use node from grammar/);
  // ... even if it's a sub-grammar
  g = ohm.makeGrammar('Expr2 <: Expr {}', {Expr: expr});
  t.throws(function() { s(g.match('1+2', 'expr')); }, /Cannot use node from grammar/);

  t.end();
});

test('_many nodes', function(t) {
  var g = ohm.makeGrammar('G { letters = letter* }');
  var actions = {
    _default: ohm.actions.passThrough,
    _terminal: ohm.actions.getPrimitiveValue
  };
  var s = g.semantics().addOperation('op', combine(actions, {_many: ohm.actions.makeArray}));
  var m = g.match('abc', 'letters');
  t.deepEqual(s(m).op(), ['a', 'b', 'c'], 'makeArray works');

  s = g.semantics().addOperation('op', combine(actions, {_many: ohm.actions.passThrough}));
  t.throws(function() { s(m).op(); }, /passThrough/, 'throws with passThrough');

  t.throws(function() {
    g.semantics().addOperation('op', combine(actions, {_many: ohm.actions.getPrimitiveValue}));
  }, /wrong arity/, 'throws with getPrimitiveValue');

  s = g.semantics().addOperation('op', combine(actions, {
    _many: function(letters) {
      t.ok(letters.every(function(l) {
        return typeof l.op === 'function';
      }), 'only arg is an array of wrappers');
      t.equal(typeof this.op, 'function', '`this` has an op() method');
      t.equal(this.node.ctorName, '_many', '`this.node` is the actual node');
      return letters.map(function(l) { return l.op(); }).join(',');
    }
  }));
  t.equal(s(m).op(), 'a,b,c');

  t.end();
});

test('_terminal nodes', function(t) {
  var g = ohm.makeGrammar('G { letters = letter* }');
  var actions = {
    _default: ohm.actions.passThrough,
    _many: ohm.actions.makeArray
  };
  var s = g.semantics().addOperation('op', combine(actions, {
    _terminal: ohm.actions.getPrimitiveValue
  }));
  var m = g.match('abc', 'letters');
  t.deepEqual(s(m).op(), ['a', 'b', 'c'], 'getPrimitiveValue works');

  t.throws(function() {
    g.semantics().addOperation('op', combine(actions, {_terminal: ohm.actions.passThrough}));
  }, /wrong arity/, 'throws with passThrough');

  t.throws(function() {
    g.semantics().addOperation('op', combine(actions, {_terminal: ohm.actions.makeArray}));
  }, /wrong arity/, 'throws with makeArray');

  s = g.semantics().addOperation('op', combine(actions, {
    _terminal: function() {
      t.equal(arguments.length, 0, 'there are no arguments');
      t.equal(this.node.ctorName, '_terminal');
      t.equal(this.node.children.length, 0, 'node has no children');
      return this.node.primitiveValue;
    }
  }));
  t.deepEqual(s(m).op(), ['a', 'b', 'c']);

  t.end();
});

test('semantic action arity checks', function(t) {
  var g = ohm.makeGrammar('G {}');
  function makeOperation(grammar, actions) {
    return grammar.semantics().addOperation('op' + util.uniqueId(), actions);
  }
  function ignore0() {}
  function ignore1(a) {}
  function ignore2(a, b) {}

  t.ok(makeOperation(g, {}), 'empty actions with empty grammar');
  t.ok(makeOperation(g, {foo: null}), 'unrecognized action names are ignored');

  t.throws(function() { makeOperation(g, {_many: ignore0}); }, /arity/, '_many');
  t.ok(makeOperation(g, {_many: ignore1}), '_many works with one arg');

  t.throws(function() { makeOperation(g, {_default: ignore0}); }, /arity/, '_default is checked');
  t.ok(makeOperation(g, {_default: ignore1}), '_default works with one arg');

  t.throws(function() {
    makeOperation(g, {_terminal: ignore1});
  }, /arity/, '_terminal is checked');
  t.ok(makeOperation(g, {_terminal: ignore0}), '_terminal works with no args');

  t.throws(function() {
    makeOperation(g, {letter: ignore0});
  }, /arity/, 'built-in rules are checked');
  t.ok(makeOperation(g, {letter: ignore1}), 'letter works with one arg');

  g = util.makeGrammar([
    'G {',
    '  one = two',
    '  two = "2" letter',
    '}']);
  t.ok(makeOperation(g, {one: ignore1, two: ignore2}));

  t.throws(function() {
    makeOperation(g, {one: ignore0, two: ignore2});
  }, /wrong arity/, "'one', is checked");
  t.throws(function() {
    makeOperation(g, {one: ignore1, two: ignore0});
  }, /wrong arity/, "'two' is checked");

  var g2 = ohm.makeGrammar('G2 <: G {}', {G: g});
  t.throws(function() {
    makeOperation(g2, {one: ignore2});
  }, /wrong arity/, 'supergrammar rules are checked');
  t.ok(makeOperation(g2, {one: ignore1}), 'works with one arg');

  var g3 = ohm.makeGrammar('G3 <: G { one := "now" "two" }', {G: g});
  t.throws(function() {
    makeOperation(g3, {one: ignore1});
  }, /wrong arity/, 'changing arity in an overridden rule');
  t.ok(makeOperation(g3, {one: ignore2}));

  t.end();
});

test('extending semantics', function(t) {
  var ns = util.makeGrammars([
    'G { ',
    '  one = "one"',
    '  two = "two"',
    '}',
    'G2 <: G {',
    '  one := "eins" "!"',
    '  three = "drei"',
    '}']);
  var s = ns.G.semantics().
      addOperation('value', {
        one: function(_) { return 1; },
        two: function(_) { return 2; },
        _terminal: ohm.actions.getPrimitiveValue
      }).
      addOperation('valueTimesTwo', {
        _default: function(children) { return this.value() * 2; }
      });
  t.throws(function() { ns.G2.semantics(s).addOperation('value', {}); }, /already exists/);
  t.throws(function() { ns.G2.semantics(s).extendOperation('value', {}); }, /wrong arity/);
  t.throws(function() { ns.G2.semantics(s).extendOperation('foo', {}); }, /did not inherit/);
  t.throws(function() { ns.G.semantics().extendOperation('value', {}); }, /did not inherit/);

  var s2 = ns.G2.semantics(s).extendOperation('value', {
    one: function(str, _) { return 21; },  // overriding
    three: function(str) { return 3; }     // adding a new case
  });
  var m = ns.G2.match('eins!', 'one');
  t.equal(s2(m).value(), 21);
  t.equal(s2(m).valueTimesTwo(), 42);

  m = ns.G2.match('two', 'two');
  t.equal(s2(m).value(), 2);
  t.equal(s2(m).valueTimesTwo(), 4);

  m = ns.G2.match('drei', 'three');
  t.equal(s2(m).value(), 3);
  t.equal(s2(m).valueTimesTwo(), 6);

  t.end();
});

test('mixing nodes from one grammar with semantics from another', function(t) {
  var ns = util.makeGrammars([
    'G {',
    '  start = "aaa"',
    '}',
    'GPrime <: G {',
    '  start := "bbb"',
    '}',
    'Unrelated {',
    '  start = "asdf"',
    '}'
  ]);

  var s = ns.G.semantics().addOperation('value', {
    start: function(x) { return x.value() + 'choo!'; },
    _terminal: function() { return this.node.primitiveValue; }
  });

  var m = ns.G.match('aaa', 'start');
  t.equal(s(m).value(), 'aaachoo!');

  m = ns.GPrime.match('bbb', 'start');
  t.throws(function() { s(m).value(); }, /node from grammar/);

  m = ns.Unrelated.match('asdf', 'start');
  t.throws(function() { s(m).value(); }, /node from grammar/);

  t.end();
});
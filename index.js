/**
 * @license
 * Copyright (c) 2014 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

// jshint node: true
'use strict';

var dom5 = require('@banno/dom5');
var parse5 = require('parse5');
var pred = dom5.predicates;
var sourcemaps = require('source-map');

var inlineScriptFinder = pred.AND(
  pred.hasTagName('script'),
  pred.OR(
    pred.NOT(
      pred.hasAttr('type')
    ),
    pred.hasAttrValue('type', 'text/ecmascript-6'),
    pred.hasAttrValue('type', 'application/javascript'),
    pred.hasAttrValue('type', 'text/javascript')
  ),
  pred.NOT(
    pred.hasAttr('src')
  )
);

var noSemiColonInsertion = /\/\/|;\s*$|\*\/\s*$/;

module.exports = function crisp(options) {
  var source = options.source || '';
  var jsFileName = options.jsFileName || '';
  var scriptInHead = options.scriptInHead !== false;
  var onlySplit = options.onlySplit || false;
  var alwaysWriteScript = options.alwaysWriteScript || false;

  var doc = parse5.parse(source, {locationInfo: true});
  var body = dom5.query(doc, pred.hasTagName('body'));
  var head = dom5.query(doc, pred.hasTagName('head'));
  var scripts = dom5.queryAll(doc, inlineScriptFinder);
  var sourceMapCommentExpr = /\n\/\/# sourceMappingURL\=data:application\/json;charset=utf8;base64,([a-zA-Z0-9\+\/=]+)\n$/;

  var contents = [];
  var outputMap = new sourcemaps.SourceMapGenerator();
  var mapLineOffset = 0;
  var hasSourceMappings = false;

  scripts.forEach(function(sn) {
    var nidx = sn.parentNode.childNodes.indexOf(sn) + 1;
    var next = sn.parentNode.childNodes[nidx];
    dom5.remove(sn);
    // remove newline after script to get rid of nasty whitespace
    if (next && dom5.isTextNode(next) && !/\S/.test(dom5.getTextContent(next))) {
      dom5.remove(next);
    }
    var content = dom5.getTextContent(sn);

    var sourceMapContentParts = sourceMapCommentExpr.exec(content);
    if (sourceMapContentParts) {
      var contentLines = content.split('\n');
      var leadingBlankLines = 0, firstLineColumnOffset = 0;
      for (var i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim().length === 0) {
          leadingBlankLines++;
        } else {
          var leadingWhitespace = /^\s*/.exec(contentLines[i]);
          if (leadingWhitespace) {
            firstLineColumnOffset = leadingWhitespace[0].length;
          }
          break;
        }
      }

      var sourceMapContent = Buffer.from(sourceMapContentParts[1], 'base64');
      content = content.replace(sourceMapCommentExpr, '').replace(/\s+$/, '').trim();
      var originalMap = new sourcemaps.SourceMapConsumer(sourceMapContent.toString());

      originalMap.eachMapping(function(mapping) {
        var newMapping = {
          source: mapping.source,
          generated: {
            line: mapLineOffset - leadingBlankLines + (mapping.generatedLine - sn.__location.startTag.line + 1),
            column: mapping.generatedColumn -
                (mapping.generatedLine - sn.__location.startTag.line === 1 ? firstLineColumnOffset : 0)
          }
        };

        if (mapping.originalLine !== undefined && mapping.originalLine !== null &&
            mapping.originalColumn !== undefined && mapping.originalColumn !== null) {
          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };
        }

        if (mapping.name) {
          newMapping.name = mapping.name;
        }
        outputMap.addMapping(newMapping);
        hasSourceMappings = true;
      });
    } else {
      content = content.trim();
    }
    var lines = content.split('\n');
    var lastline = lines[lines.length - 1];
    if (!noSemiColonInsertion.test(lastline)) {
      content += ';';
    }
    mapLineOffset += lines.length;
    contents.push(content);
  });

  if (!onlySplit) {
    if (contents.length > 0 || alwaysWriteScript) {
      var newScript = dom5.constructors.element('script');
      dom5.setAttribute(newScript, 'src', jsFileName);
      if (scriptInHead) {
        dom5.setAttribute(newScript, 'defer', '');
        head.childNodes.unshift(newScript);
        newScript.parentNode = head;
      } else {
        dom5.append(body, newScript);
      }
    }
  }

  if (hasSourceMappings) {
    var base64Map = new Buffer(outputMap.toString()).toString('base64');
    contents.push('\n//# sourceMappingURL=data:application/json;charset=utf8;base64,' + base64Map + '\n');
  } else {}

  var html = parse5.serialize(doc);
  // newline + semicolon should be enough to capture all cases of concat
  var js = contents.join('\n');

  return {
    html: html,
    js: js
  };
};

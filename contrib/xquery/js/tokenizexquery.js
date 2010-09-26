var tokenizeXquery = (function() {
    // Advance the stream until the given character (not preceded by a
    // backslash) is encountered, or the end of the line is reached.
    function nextUntilUnescaped(source, end) {
        var escaped = false;
        while (!source.endOfLine()) {
            var next = source.next();
            if (next == end && !escaped)
            return false;
            escaped = !escaped && next == "\\";
            console.debug(escaped);
        }
        return escaped;
    }

    // A map of Xquery's keywords. The a/b/c keyword distinction is
    // very rough, but it gives the parser enough information to parse
    // correct code correctly (we don't care that much how we parse
    // incorrect code). The style information included in these objects
    // is used by the highlighter to pick the correct CSS style for a
    // token.
    var keywords = function() {
        function result(type, style) {
            return {
                type: type,
                style: style
            };
        }

        var allKeywords = {};
        var keywordsList = {};

        // keywords that take a parenthised expression, and then a statement (if)
        keywordsList['xqueryKeywordA'] = new Array('if', 'switch', 'while');

        // keywords that take just a statement (else)
        keywordsList['xqueryKeywordB'] = new Array('else', 'then', 'try', 'finally');

        // keywords that optionally take an expression, and form a statement (return)
        keywordsList['xqueryKeywordC'] = new Array('element', 'attribute', 'let', 'implements', 'import', 'module', 'namespace', 'return', 'super', 'this', 'throws');

        keywordsList['xqueryOperator'] = new Array('eq', 'ne', 'lt', 'le', 'gt', 'ge');

        for (var keywordType in keywordsList) {
            for (var i = 0; i < keywordsList[keywordType].length; i++) {
                allKeywords[keywordsList[keywordType][i]] = result(keywordType, "xqueryKeyword");
            }
        }

        keywordsList = {};

        keywordsList['xqueryAtom'] = new Array('null', 'fn:false()', 'fn:true()');
        for (var keywordType in keywordsList) {
            for (var i = 0; i < keywordsList[keywordType].length; i++) {
                allKeywords[keywordsList[keywordType][i]] = result(keywordType, keywordType);
            }
        }

        keywordsList = {};

        keywordsList['xqueryModifier'] = new Array('xquery', 'ascending', 'descending');

        keywordsList['xqueryType'] = new Array('xs:string', 'xs:float', 'xs:decimal', 'xs:double', 'xs:integer', 'xs:boolean', 'xs:date', 'xx:dateTime', 'xs:time', 'xs:duration', 'xs:dayTimeDuration', 'xs:time', 'xs:yearMonthDuration', 'numeric', 'xs:hexBinary', 'xs:base64Binary', 'xs:anyURI', 'xs:QName');
        for (var keywordType in keywordsList) {
            for (var i = 0; i < keywordsList[keywordType].length; i++) {
                allKeywords[keywordsList[keywordType][i]] = result('function', keywordType);
            }
        }

        allKeywords = objectConcat(allKeywords, {
            "catch": result("catch", "xqueryKeyword"),
            "for": result("for", "xqueryKeyword"),
            "case": result("case", "xqueryKeyword"),
            "default": result("default", "xqueryKeyword"),
            "instanceof": result("operator", "xqueryKeyword")
        });

        // ------------------- xquery keywords
        var keywordsList = {};

        // keywords that optionally take an expression, and form a statement (return)
        keywordsList['xqueryKeywordC'] = new Array('assert', 'property');
        for (var i = 0; i < keywordsList['xqueryKeywordC'].length; i++) {
            allKeywords[keywordsList['xqueryKeywordC'][i]] = result("xqueryKeywordC", "xqueryKeyword");
        }

        // other xquery keywords
        allKeywords = objectConcat(allKeywords, {
            "as": result("operator", "xqueryKeyword"),
            "in": result("operator", "xqueryKeyword"),
            "at": result("operator", "xqueryKeyword"),
            "declare": result("function", "xqueryKeyword"),
            "function": result("function", "xqueryKeyword")
        });
        return allKeywords;
    } ();

    function specialCases(source, word) {
        if (word in {
            "fn:true": "",
            "fn:false": ""
        } && source.lookAhead("()", false)) {
            source.next();
            source.next();
            source.get();
            return {
                type: "function",
                style: "xqueryAtom",
                content: word + "()"
            };
        }
        else if (word in {
            "node": "",
            "item": "",
            "text": ""
        } && source.lookAhead("()", false)) {
            source.next();
            source.next();
            source.get();
            return {
                type: "function",
                style: "xqueryType",
                content: word + "()"
            };
        }
        else if (source.lookAhead("(")) {
            return {
                type: "function",
                style: "xqueryFunction",
                content: word
            };
        }
        else return null;
    }

    // Some helper regexp matchers.
    var isOperatorChar = /[+\-/ * &%@ = !?|] / ;
    var isDigit = /[0-9]/;
    var isHexDigit = /^[0-9A-Fa-f]$/;
    var isWordChar = /[\w\:\-\$_]/;
    var isVariableChar = /[\w\$_]/;
    var isXqueryVariableChar = /[\w\.()\[\]{}]/;
    var isPunctuation = /[\[\]{}\(\),;\.]/;
    var isStringDelimeter = /^[\/'"]$/;
    var isRegexpDelimeter = /^[\/'$]/;
    var tagnameChar = /[<\w\:\-\/_]/;

    // Wrapper around xqueryToken that helps maintain parser state (whether
    // we are inside of a multi-line comment and whether the next token
    // could be a regular expression).
    function xqueryTokenState(inside, regexp) {
        return function(source, setState) {
            var newInside = inside;
            var type = xqueryToken(inside, regexp, source,
            function(c) {
                newInside = c;
            });
            var newRegexp = type.type == "operator" || type.type == "xqueryKeywordC" || type.type == "xqueryKeywordC" || type.type.match(/^[\[{}\(,;:]$/);
            if (newRegexp != regexp || newInside != inside)
            setState(xqueryTokenState(newInside, newRegexp));
            return type;
        };
    }

    // The token reader, inteded to be used by the tokenizer from
    // tokenize.js (through xqueryTokenState). Advances the source stream
    // over a token, and returns an object containing the type and style
    // of that token.
    function xqueryToken(inside, regexp, source, setInside) {
        function readHexNumber() {
            setInside(null);
            source.next();
            // skip the 'x'
            source.nextWhileMatches(isHexDigit);
            return {
                type: "number",
                style: "xqueryNumber"
            };
        }

        function readNumber() {
            setInside(null);
            source.nextWhileMatches(isDigit);
            if (source.equals(".")) {
                source.next();

                // read ranges
                if (source.equals("."))
                source.next();

                source.nextWhileMatches(isDigit);
            }
            if (source.equals("e") || source.equals("E")) {
                source.next();
                if (source.equals("-"))
                source.next();
                source.nextWhileMatches(isDigit);
            }
            return {
                type: "number",
                style: "xqueryNumber"
            };
        }
        // Read a word, look it up in keywords. If not found, it is a
        // variable, otherwise it is a keyword of the type found.
        function readWord() {
            setInside(null);
            source.nextWhileMatches(isWordChar);
            var word = source.get();
            var specialCase = specialCases(source, word);
            if (specialCase) return specialCase;
            var known = keywords.hasOwnProperty(word) && keywords.propertyIsEnumerable(word) && keywords[word];
            if (known) return {
                type: known.type,
                style: known.style,
                content: word
            }
            return {
                type: "word",
                style: "word",
                content: word
            };
        }


        // read regexp like /\w{1}:\\.+\\.+/
        function readRegexp() {
            // go to the end / not \/
            nextUntilUnescaped(source, "/");

            return {
                type: "regexp",
                style: "xqueryRegexp"
            };
        }

        // Mutli-line comments are tricky. We want to return the newlines
        // embedded in them as regular newline tokens, and then continue
        // returning a comment token for every line of the comment. So
        // some state has to be saved (inside) to indicate whether we are
        // inside a /* */ sequence.
        function readMultilineComment(start) {
            var newInside = "(:";
            var maybeEnd = (start == ":");
            while (true) {
                if (source.endOfLine())
                break;
                var next = source.next();
                if (next == ")" && maybeEnd) {
                    newInside = null;
                    break;
                }
                maybeEnd = (next == ":");
            }
            setInside(newInside);
            return {
                type: "comment",
                style: "xqueryComment"
            };
        }

        function readOperator() {
            if (ch == "=")
            setInside("=")
            else if (ch == "~")
            setInside("~")
            else if (ch == ":" && source.equals("=")) {
                setInside(null);
                source.nextWhileMatches(/[:=]/);
                var word = source.get();
                return {
                    type: "operator",
                    style: "xqueryOperator",
                    content: word
                };
            }
            else setInside(null);

            return {
                type: "operator",
                style: "xqueryOperator"
            };
        }

        function readString(quote) {
            var newInside = quote;
            var previous = "";
            while (true) {
                if (source.endOfLine())
                break;
                var next = source.next();
                if (next == quote && previous != "\\") {
                    newInside = null;
                    break;
                }
                previous = next;
            }
            setInside(newInside);
            return {
                type: "string",
                style: "xqueryString"
            };
        }

        function readVariable() {
            setInside(null);
            source.nextWhileMatches(isVariableChar);
            var word = source.get();
            return {
                type: "variable",
                style: "xqueryVariable",
                content: word
            };
        }

        function readTagname(lt) {
            var tagtype = (source.lookAhead("/", false)) ? "xml-tag-close": "xml-tag-open";
            source.nextWhileMatches(tagnameChar);
            var word = source.get();
            if (source.lookAhead(">", false)) {
                source.next();
            }
            return {
                type: tagtype,
                style: "xml-tagname",
                content: word
            };
        }

        // Fetch the next token. Dispatches on first character in the
        // stream, or first two characters when the first is a slash.

        if (inside == "\"" || inside == "'")
        return readString(inside);
        var ch = source.next();
        if (inside == "(:")
        return readMultilineComment(ch);
        else if (ch == "\"" || ch == "'")
        return readString(ch);


        // test if this is range
        else if (ch == "." && source.equals(".")) {
            source.next();
            return {
                type: "..",
                style: "xqueryOperator"
            };
        }

        else if (ch == "(" && source.equals(":")) {
            source.next();
            return readMultilineComment(ch);
        }
        else if (ch == "$")
        return readVariable();
        else if (ch == ":" && source.equals("="))
        return readOperator();

        // with punctuation, the type of the token is the symbol itself
        else if (isPunctuation.test(ch))
        return {
            type: ch,
            style: "xqueryPunctuation"
        };
        else if (ch == "0" && (source.equals("x") || source.equals("X")))
        return readHexNumber();
        else if (isDigit.test(ch))
        return readNumber();

        else if (ch == "~") {
            setInside("~");
            // prepare to read slashy string like ~ /\w{1}:\\.+\\.+/
            return readOperator(ch);
        }
        else if (isOperatorChar.test(ch))
        return readOperator(ch);
        // some xml handling stuff
        else if (ch == "<")
        return readTagname(ch);
        else if (ch == ">")
        return {
            type: "xml-tag",
            style: "xml-tagname"
        };
        else
        return readWord();
    }

    // returns new object = object1 + object2
    function objectConcat(object1, object2) {
        for (var name in object2) {
            if (!object2.hasOwnProperty(name)) continue;
            if (object1.hasOwnProperty(name)) continue;
            object1[name] = object2[name];
        }
        return object1;
    }

    // The external interface to the tokenizer.
    return function(source, startState) {
        return tokenizer(source, startState || xqueryTokenState(false, true));
    };
})();
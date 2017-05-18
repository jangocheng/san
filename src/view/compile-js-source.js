/**
 * @file 将组件编译成 render 方法的 js 源码
 * @author errorrik(errorrik@gmail.com)
 */

var serializeStump = require('./serialize-stump');
var ExprType = require('../parser/expr-type');
var CompileSourceBuffer = require('./compile-source-buffer');
var compileExprSource = require('./compile-expr-source');
var flatComponentBinds = require('./flat-component-binds');


// #[begin] ssr

/**
 * ANode 的编译方法集合对象
 *
 * @inner
 */
var aNodeCompiler = {
    /**
     * 编译节点
     *
     * @param {ANode} aNode 抽象节点
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {Component} owner 所属组件实例环境
     */
    compile: function (aNode, sourceBuffer, owner, extra) {
        extra = extra || {};
        var compileMethod = 'compileElement';

        if (aNode.isText) {
            compileMethod = 'compileText';
        }
        else if (aNode.directives.get('if')) {
            compileMethod = 'compileIf';
        }
        else if (aNode.directives.get('else')) {
            compileMethod = 'compileElse';
        }
        else if (aNode.directives.get('for')) {
            compileMethod = 'compileFor';
        }
        else if (aNode.tagName === 'slot') {
            compileMethod = 'compileSlot';
        }
        else {
            var ComponentType = owner.components[aNode.tagName];
            if (ComponentType) {
                compileMethod = 'compileComponent';
                extra.ComponentClass = ComponentType;
            }
        }

        aNodeCompiler[compileMethod](aNode, sourceBuffer, owner, extra);
    },

    /**
     * 编译文本节点
     *
     * @param {ANode} aNode 节点对象
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     */
    compileText: function (aNode, sourceBuffer) {
        sourceBuffer.joinExpr(aNode.textExpr);

        if (!aNode.textExpr.value) {
            sourceBuffer.joinString(serializeStump('text', aNode.text));
        }
    },

    /**
     * 编译 if 节点
     *
     * @param {ANode} aNode 节点对象
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {Component} owner 所属组件实例环境
     */
    compileIf: function (aNode, sourceBuffer, owner) {
        var ifElementANode = new ANode({
            childs: aNode.childs,
            props: aNode.props,
            events: aNode.events,
            tagName: aNode.tagName,
            directives: (new IndexedList()).concat(aNode.directives)
        });
        ifElementANode.directives.remove('if');

        var ifDirective = aNode.directives.get('if');
        var elseANode = aNode.elseANode;

        // for condition true content
        sourceBuffer.addRaw('if (' + compileExprSource.expr(ifDirective.value) + ') {');
        sourceBuffer.addRaw(
            aNodeCompiler.compile(
                ifElementANode,
                sourceBuffer,
                owner,
                {prop: ' san-if="' + escapeHTML(ifDirective.raw) + '"'}
            )
        );
        if (elseANode) {
            sourceBuffer.joinString(serializeStump('else', serializeANode(elseANode)));
        }

        // for condition false content
        sourceBuffer.addRaw('} else {');
        sourceBuffer.joinString(serializeStump('if', serializeANode(aNode)));

        if (elseANode) {
            var elseElementANode = new ANode({
                childs: elseANode.childs,
                props: elseANode.props,
                events: elseANode.events,
                tagName: elseANode.tagName,
                directives: (new IndexedList()).concat(elseANode.directives)
            });
            elseElementANode.directives.remove('else');
            sourceBuffer.addRaw(
                aNodeCompiler.compile(
                    elseElementANode,
                    sourceBuffer,
                    owner,
                    {prop: ' san-else'}
                )
            );
        }

        sourceBuffer.addRaw('}');
    },

    /**
     * 编译 else 节点
     *
     * @param {ANode} aNode 节点对象
     */
    compileElse: function (aNode) {
        // 啥都不干，交给 compileIf 了
    },

    /**
     * 编译 for 节点
     *
     * @param {ANode} aNode 节点对象
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {Component} owner 所属组件实例环境
     */
    compileFor: function (aNode, sourceBuffer, owner) {
        var forElementANode = new ANode({
            childs: aNode.childs,
            props: aNode.props,
            events: aNode.events,
            tagName: aNode.tagName,
            directives: (new IndexedList()).concat(aNode.directives)
        });
        forElementANode.directives.remove('for');

        var forDirective = aNode.directives.get('for');
        var itemName = forDirective.item.raw;
        var indexName = forDirective.index.raw;
        var listName = compileExprSource.dataAccess(forDirective.list);

        sourceBuffer.addRaw('for ('
            + 'var ' + indexName + ' = 0; '
            + indexName + ' < ' + listName + '.length; '
            + indexName + '++) {'
        );
        sourceBuffer.addRaw('componentCtx.data.' + indexName + '=' + indexName + ';');
        sourceBuffer.addRaw('componentCtx.data.' + itemName + '= ' + listName + '[' + indexName + '];');
        sourceBuffer.addRaw(
            aNodeCompiler.compile(
                forElementANode,
                sourceBuffer,
                owner,
                {prop: ' san-for="' + escapeHTML(forDirective.raw) + '"'}
            )
        );
        sourceBuffer.addRaw('}');

        // for stump
        sourceBuffer.joinString(serializeStump('for', serializeANode(aNode)));
    },

    /**
     * 编译 slot 节点
     *
     * @param {ANode} aNode 节点对象
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {Component} owner 所属组件实例环境
     */
    compileSlot: function (aNode, sourceBuffer, owner) {
        var nameProp = aNode.props.get('name');
        var name = nameProp ? nameProp.raw : '____';
        var extraProp = nameProp ? ' name="' + name + '"' : '';
        var isGivenContent = 0;
        var childs = aNode.childs;

        if (owner.aNode.givenSlots[name]) {
            isGivenContent = 1;
            childs = owner.aNode.givenSlots[name];
        }


        if (!isGivenContent) {
            extraProp += ' by-default="1"';
        }
        sourceBuffer.joinString(serializeStump('slot-start', '', extraProp));

        if (isGivenContent) {
            sourceBuffer.addRaw('(function (componentCtx) {');
        }

        each(childs, function (aNodeChild) {
            sourceBuffer.addRaw(aNodeCompiler.compile(aNodeChild, sourceBuffer, owner));
        });

        if (isGivenContent) {
            sourceBuffer.addRaw('})(componentCtx.owner);');
        }

        sourceBuffer.joinString(serializeStump('slot-stop'));
    },

    /**
     * 编译普通节点
     *
     * @param {ANode} aNode 节点对象
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {Component} owner 所属组件实例环境
     */
    compileElement: function (aNode, sourceBuffer, owner, extra) {
        extra = extra || {};
        elementSourceCompiler.tagStart(
            sourceBuffer,
            aNode.tagName,
            aNode.props,
            aNode.props,
            extra.prop
        );


        mergeIfAndElse(aNode.childs);
        elementSourceCompiler.inner(sourceBuffer, aNode, owner);
        elementSourceCompiler.tagEnd(sourceBuffer, aNode.tagName);
    },

    /**
     * 编译组件节点
     *
     * @param {ANode} aNode 节点对象
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {Component} owner 所属组件实例环境
     * @param {Function} extra.ComponentClass 对应组件类
     */
    compileComponent: function (aNode, sourceBuffer, owner, extra) {
        var ComponentClass = extra.ComponentClass;
        var component = new ComponentClass({
            aNode: aNode,
            owner: owner,
            subTag: aNode.tagName
        });

        var givenData = [];

        flatComponentBinds(aNode.props);
        aNode.props.each(function (prop) {
            givenData.push(
                compileExprSource.stringLiteralize(prop.name)
                + ':'
                + compileExprSource.expr(prop.expr)
            );
        });

        sourceBuffer.addRaw('html += (');
        sourceBuffer.addRendererStart();
        compileComponentSource(sourceBuffer, component, extra && extra.prop);
        sourceBuffer.addRendererEnd();
        sourceBuffer.addRaw(')({' + givenData.join(',\n') + '}, componentCtx);');
    }
};

/**
 * element 的编译方法集合对象
 *
 * @inner
 */
var elementSourceCompiler = {
    /**
     * 编译元素标签头
     *
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {string} tagName 标签名
     * @param {IndexedList} props 属性列表
     * @param {IndexedList} binds 绑定信息列表
     * @param {string?} extraProp 额外的属性串
     */
    tagStart: function (sourceBuffer, tagName, props, binds, extraProp) {
        sourceBuffer.joinString('<' + tagName);
        sourceBuffer.joinString(extraProp || '');

        binds.each(function (bindInfo) {
            sourceBuffer.joinString(' prop-' + bindInfo.name + '="' + bindInfo.raw + '"');
        });

        props.each(function (prop) {
            if (tagName === 'textarea' && prop.name === 'value') {
                return;
            }

            switch (prop.name) {
                case 'readonly':
                case 'disabled':
                case 'mutiple':
                    break;

                default:
                    if (prop.expr.value) {
                        sourceBuffer.joinString(' ' + prop.name + '="' + prop.expr.value + '"');
                    }
                    else {
                        sourceBuffer.joinString(' ' + prop.name + '="');
                        sourceBuffer.joinExpr(prop.expr);
                        sourceBuffer.joinString('"');
                    }
                    break;
            }
        });

        sourceBuffer.joinString('>');
    },

    /**
     * 编译元素闭合
     *
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {string} tagName 标签名
     */
    tagEnd: function (sourceBuffer, tagName) {
        if (!autoCloseTags[tagName]) {
            sourceBuffer.joinString('</' + tagName + '>');
        }
    },

    /**
     * 编译元素内容
     *
     * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
     * @param {ANode} aNode 元素的抽象节点信息
     * @param {Component} owner 所属组件实例环境
     */
    inner: function (sourceBuffer, aNode, owner) {
        // inner content
        // var valueProp = component.props.get('value');
        // if (tagName === 'textarea' && valueProp) {
        //     if (valueProp) {
        //         sourceBuffer.joinString(valueProp.value);
        //     }
        // }
        // else {

        // }
        each(aNode.childs, function (aNodeChild) {
            sourceBuffer.addRaw(aNodeCompiler.compile(aNodeChild, sourceBuffer, owner));
        });
    }
};

// TODO: 重新处理if和else的编译
function mergeIfAndElse(childs) {
    var ifANode;
    each(childs, function (child) {
        if (child.isText) {
            return;
        }

        if (child.directives.get('if')) {
            ifANode = child;
            return;
        }

        if (child.directives.get('else')) {
            if (ifANode) {
                ifANode.elseANode = child;
            }
        }

        ifANode = null;
    });
}

/**
 * 生成组件 renderer 时 ctx 对象构建的代码
 *
 * @inner
 * @param {CompileSourceBuffer} sourceBuffer 编译源码的中间buffer
 * @param {Object} component 组件实例
 * @param {string?} extraProp 额外的属性串
 */
function compileComponentSource(sourceBuffer, component, extraProp) {
    var tagName = component.tagName;

    sourceBuffer.addRaw(genComponentContextCode(component));
    sourceBuffer.addRaw('componentCtx.owner = parentCtx;');
    sourceBuffer.addRaw('data = extend(componentCtx.data, data);');

    extraProp = extraProp || '';
    if (component.subTag) {
        extraProp += ' san-component="' + component.subTag + '"';
    }

    elementSourceCompiler.tagStart(
        sourceBuffer,
        component.tagName,
        component.props,
        component.binds,
        extraProp
    );

    if (!component.owner) {
        sourceBuffer.joinString('<script type="text/san" san-stump="data">');
        sourceBuffer.joinDataStringify();
        sourceBuffer.joinString('</script>');
    }

    mergeIfAndElse(component.aNode.childs);
    elementSourceCompiler.inner(sourceBuffer, component.aNode, component);
    elementSourceCompiler.tagEnd(sourceBuffer, component.tagName);
}

/**
 * 生成组件 renderer 时 ctx 对象构建的代码
 *
 * @inner
 * @param {Object} component 组件实例
 * @return {string}
 */
function genComponentContextCode(component) {
    var code = ['var componentCtx = {'];

    // filters
    code.push('filters: {');
    var filterCode = [];
    for (var key in component.filters) {
        var filter = component.filters[key];

        if (typeof filter === 'function') {
            filterCode.push(key + ': ' + filter.toString());
        }
    }
    code.push(filterCode.join(','));
    code.push('},');

    code.push(
        'callFilter: function (name, args) {',
        '    var filter = this.filters[name] || DEFAULT_FILTERS[name];',
        '    if (typeof filter === "function") {',
        '        return filter.apply(this, args);',
        '    }',
        '},'
    );

    // computed
    code.push('computed: {');
    var computedCode = [];
    for (var key in component.computed) {
        var computed = component.computed[key];

        if (typeof computed === 'function') {
            computedCode.push(key + ': ' + computed.toString());
        }
    }
    code.push(computedCode.join(','));
    code.push('},');

    // data
    code.push('data: ' + JSON.stringify(component.data.get()) + ',');

    // tagName
    code.push('tagName: "' + component.tagName + '"');
    code.push('};');

    return code.join('\n');
}

/**
 * 组件编译的模板函数
 *
 * @inner
 */
function componentCompilePreCode() {
    function extend(target, source) {
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                target[key] = source[key];
            }
        }

        return target;
    }

    var HTML_ENTITY = {
        /* jshint ignore:start */
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        /* eslint-disable quotes */
        "'": '&#39;'
        /* eslint-enable quotes */
        /* jshint ignore:end */
    };

    function htmlFilterReplacer(c) {
        return HTML_ENTITY[c];
    }

    function escapeHTML(source) {
        if (source == null) {
            return '';
        }

        return String(source).replace(/[&<>"']/g, htmlFilterReplacer);
    }

    var DEFAULT_FILTERS = {
        html: escapeHTML,
        url: encodeURIComponent,
        raw: function (source) {
            return source;
        },
        _class: function (source) {
            if (source instanceof Array) {
                return source.join(' ');
            }

            return source;
        },
        _style: function (source) {
            if (typeof source === 'object') {
                var result = '';
                for (var key in source) {
                    result += key + ':' + source[key] + ';';
                }

                return result;
            }

            return source;
        },
        _sep: function (source, sep) {
            return source ? sep + source : source;
        }
    };
}

/**
 * 将组件编译成 render 方法的 js 源码
 *
 * @param {Function} ComponentClass 组件类
 * @return {string}
 */
function compileJSSource(ComponentClass) {
    var sourceBuffer = new CompileSourceBuffer();

    sourceBuffer.addRendererStart();
    sourceBuffer.addRaw(
        componentCompilePreCode.toString()
            .split('\n')
            .slice(1)
            .join('\n')
            .replace(/\}\s*$/, '')
    );

    // 先初始化个实例，让模板编译成 ANode，并且能获得初始化数据
    var component = new ComponentClass();

    compileComponentSource(sourceBuffer, component);
    sourceBuffer.addRendererEnd();
    return sourceBuffer.toCode();
}
// #[end]

exports = module.exports = compileJSSource;

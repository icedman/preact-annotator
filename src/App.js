import { h, render, Component } from 'preact';
import EventSpy from './EventSpy.js';
import { _ } from './libs.js';
import { toRange, fromRange } from 'xpath-range';

import Debug from './Debug.js';
import Highlights from './Highlights.js';
import UI from './UI.js';
import Icons from './Icons.js';

export default class App extends Component {

    constructor() {
        super();
        
        this.$root = null;
        this.$el = null;

        this.state = {
            annotations: [],
            highlights: [],
            selection: null,
            range: null,
            selectionBounds: { rect: {}, ready: false },
            canvas: {},
            offset: null,
            root: null,

            // ui
            focus: null,
            menu: null,
            subMenu: null,
            tag: ''
        };

        this.methods();

        Object.assign(this.$api,{
          annotate: (params) => this.annotate(params),
          erase: (params) => this.erase(params),
          comment: (params) => this.comment(params),
          menu: (params) => this.requestMenu(params),
          annotation: () => this.annotation(),
          tag: () => this.state.tag,
          selectionBounds: () => this.state.selectionBounds,
          clear: () => {
            this.setState({ focus: null });
            this.setState({ menu: null, _subMenu: null });
            this.clearSelection();
          }
        });
    }

    componentDidMount() {
        this.init();
    }

    componentWillUnmount() {
        EventSpy.stop();
    }

    init() {
        // run!
        //------------------
        // expose ourself
        //------------------
        window.Annot8 = this;

        //------------------
        // find the root
        //------------------
        this.$root = null;
        for(var sel of this.$config.selector) {
            var elm = document.querySelector(sel);
            if (elm) {
              this.$root = elm;
              break;
            }
        }
        if (!this.$root) {
          var pars = document.querySelectorAll('article p');
          var firstParagraph = null;
          for(var p of pars) {
            if (!p.className) {
              firstParagraph = p;
              break;
            }
          }
          if (firstParagraph) {
            var root = firstParagraph.parentElement;
            while(root) {
              if (root.nodeName == 'DIV' && root.className || root.nodeName == 'ARTICLE') {
                this.$root = root;
                this.$api.debug.log('selector @' + root.nodeName + ':' + root.className);
                break;
              }
              root = root.parentElement;
            }
          }
        } else {
          this.$api.debug.log('Selector @ found ' + this.$config.selector);
        }
        if (!this.$root) {
          this.$api.debug.log('Selector @ fallback to document.body');
          this.$root = document.body;
        }

        //------------------
        // find our app element
        //------------------
        this.$el = document.querySelector('#annot8-app');
        try {
            this.$root.appendChild(this.$el);
        } catch(e) {
        }

        //------------------
        // fire up events
        //------------------
        EventSpy.start(this.$root,
            /* selection callback */
            (sel, range) => {
                if (!sel)
                  return;
                if (this.state.subMenu == 'comments') {
                  this.setState({ subMenu: null });
                }
                this.setState({ selectionBounds: { ready: false } });
                this.onSelectionChanged(sel, range);
            },
            /* resize callback */
            () => {
                this.setState({ menu: null, subMenu: null });
                this.onDocumentResized();
            },
            /* mouse callback */
            (pos, src) => {
                this.setState({ menu: null, _subMenu: null });
                this.setState({ selectionBounds: { ready: false } });
                this.onMouseUp(pos);
            },
            /* key callback */
            (keycode) => {
              switch(keycode) {
              case 8:
                if (this.state.focus == null || this.state.subMenu == 'comments') {
                  return;
                }
                this.erase(this.state.focus);
                break;
              case 27:
                this.setState({ tag: '', menu: null, subMenu: null });
                this.clearSelection();
                break;
              }
            }
        );

        this.onRead();
    }

    //------------------
    // a little bit declarative
    // required for debounced
    //------------------
    methods() {
        Object.assign(this,
        {
            loadData(data) {
              let annotations = [];
              (data || []).forEach(a=> {
                annotations.push(Object.assign(a, { rects:[] }));
              });

              this._reindex(annotations);
              this.setState({annotations: annotations});

              this.draw();
              this.clearSelection();
            },

            onRead() {
              let storage = this.$config.storage || this.$config.source;
              if (typeof(storage.read) == 'function') {
                storage.read(this.$http)
                .then((data) => {
                  this.loadData(data);
                })
                .catch((err) => {
                  this.$api.debug.log(err);
                });
                return;
              }
            },

            onCreate(annotation) {
              let storage = this.$config.storage || this.$config.source;
              if (typeof(storage.create) == 'function') {
                storage.create(this.$http, this.state.annotations, annotation)
                .then((data) => {
                })
                .catch((err) => {
                  this.$api.debug.log(err);
                });
                return;
              }
            },

            onUpdate(annotation) {
              let storage = this.$config.storage || this.$config.source;
              if (typeof(storage.update) == 'function') {
                storage.update(this.$http, this.state.annotations, annotation)
                .then((data) => {
                })
                .catch((err) => {
                  this.$api.debug.log(err);
                });
                return;
              }
            },

            onDelete(annotation) {
              let storage = this.$config.storage || this.$config.source;
              if (typeof(storage.delete) == 'function') {
                storage.delete(this.$http, this.state.annotations, annotation)
                .then((data) => {
                })
                .catch((err) => {
                  this.$api.debug.log(err);
                });
              }
            },

            onSelectionChanged: _.debounce(function(sel, range) {
                this.setState({ selection : sel });
                this.setState({ range : range ? fromRange(range, this.$root) : null });
                this.setState({ selectionBounds: { ready: false } });
                this.calculateSelectionBounds(range);
                if (range) {
                    this.setState({ focus: null });
                    this.setState({ menu: 'create' });
                }
            }, 500),

            onDocumentResized: _.debounce(()=>{
                this.setState({ offset: null });
                this.draw();
            }, 150),

            onMouseUp: _.debounce(function(pos) {
                this.setState({ focus: null });

                var pad = 2;
                // make relative
                pos.x = pos.x - window.scrollX;
                pos.y = pos.y - window.scrollY;
                
                // get hit highlight
                var rects = [];
                var timeoutId;
                document.querySelectorAll('.annot8-hl').forEach( n=> {
                    var h = n.getClientRects()[0];
                    h.x = h.x || h.left;
                    h.y = h.y || h.top;
                    var left = h.x - pad;
                    var right = h.x + h.width + pad;
                    var top = h.y - pad;
                    var bottom = h.y + h.height + pad;

                    if (left < pos.x && right > pos.x &&
                        top < pos.y && bottom > pos.y) {
                        this.setState({ focus: parseInt(n.dataset.id) });
                        rects.push({x:pos.x, y:h.y, width:2, height:h.bottom-h.top});
                    }

                    if (this.state.focus >=0) {
                        if (timeoutId != null) {
                            clearTimeout(timeoutId);
                        }
                        let timeoutId = setTimeout(() => {
                            let rect = this.calculateBoundsFromRects(rects);
                            rect.ready = true;
                            this.setState({ selectionBounds: rect });
                            this.setState({ menu: 'edit' });
                        }, 50);
                    }
                });
            }, 50),

            _reindex(items) {
              let idx = 0;
              items.forEach( (item)=> { item.id=idx++; } );
            },

            _createAnnotation(params) {
                let annotation = {
                  quote: this.state.selection.toString(),
                  range: JSON.stringify(this.state.range),
                  tag: params.tag || this.state.tag,
                  rects: []
                };

                let annotations = [ ...this.state.annotations, annotation ];
                this._reindex(annotations);
                this.setState({ annotations: annotations });

                this.onCreate(annotation)
            },

            _updateAnnotation(params) {
              try {
                  let annotation = this.state.annotations[params.id];
                  let annotations = [ ...this.state.annotations ];
                  annotations.splice(params.id,1);
                  
                  if (params.tag != undefined) {
                    annotation.tag = params.tag;
                  }
                  if (params.comment != undefined) {
                    annotation.comment = params.comment;
                  }

                  annotations.push(annotation);
                  this._reindex(annotations);

                  this.setState({ annotations: annotations });
                  this.draw();
                  this.clearSelection();

                  this.onUpdate(annotation);
              } catch(e) {
                  // why?
                  console.log(e);
              }
            },

            annotation() {
              if (this.state.focus != null) {
                return this.state.annotations[this.state.focus];
              }
              return null;
            },

            annotate(params) {
              this.$api.debug.log(params);

              params = params || {};
              this.setState({tag: params.tag || ''});

              if (this.state.selection) {
                this._createAnnotation(params);
              } else if (params.id != undefined) {
                this._updateAnnotation(params);
              }

              this.draw();
              this.clearSelection();
              this.setState({ menu: null, subMenu: null });
            },

            comment(params) {
              this._updateAnnotation(params);
              this.setState({ menu: null, subMenu: null });
            },

            erase(idx) {
                try {
                    let annotation = this.state.annotations[idx];
                    let annotations = [ ...this.state.annotations ];
                    annotations.splice(idx,1);
                    this._reindex(annotations);
                    this.setState({ annotations: annotations });
                    this.draw();
                    this.clearSelection();
                    this.onDelete(annotation);
                } catch(e) {
                    // why?
                    console.log(idx);
                    console.log(e);
                }
            },

            clearSelection() {
              if (window.getSelection) {
                  if (window.getSelection().empty) {  // Chrome
                      window.getSelection().empty();
                  } else if (window.getSelection().removeAllRanges) {  // Firefox
                      window.getSelection().removeAllRanges();
                  }
              } else if (document.selection) {  // IE?
                  document.selection.empty();
              }

              this.setState({ selection: null });
              this.setState({ range: null });
              this.setState({ focus: null });
            },

            calculateSelectionBounds: _.debounce(function(range) {
              if (range == null)
                return;

              if (this.$config.mobile) {
                this.setState({ ready: true });
                return;
              }

              try {
                let rect = this.calculateBoundsFromRects(range.getClientRects());
                rect.ready = true;
                this.setState({ selectionBounds: rect });
              } catch(e) {
                // this.$api.debug.log(e);
              }
            }, 50),

            calculateBoundsFromRects: function(rects) {
              let rect = {};

              for(let clientRect of rects) {
                let x = clientRect.x || clientRect.left;
                let y = clientRect.y || clientRect.top;
                let x2 = x + (clientRect.width || 0);
                let y2 = y + (clientRect.height || 0);

                if (rect.x > x || !rect.x) {
                  rect.x = x;
                }
                if (rect.y > y || !rect.y) {
                  rect.y = y;
                }
                if (rect.x2 < x2 || !rect.x2) {
                  rect.x2 = x2;
                }
                if (rect.y2 < y2 || !rect.y2) {
                  rect.y2 = y2;
                }
              }

              rect.width = rect.x2 - rect.x;
              rect.height = rect.y2 - rect.y;
              rect.ready = true;

              rect.x = rect.x + window.scrollX;
              rect.y = rect.y + window.scrollY;
              return rect;
            },

            setZIndices() {
              let elm = this.$root;
              let z = 1;
              while(elm && elm !== document.body) {
                if (!elm.style.zIndex) {
                  elm.style.zIndex = z++;
                }
                elm = elm.parentElement;
              }
            },

            accountForOffsets: _.debounce(function() {
              try {
                let canvas = document.querySelector('.annot8-canvas');
                let canvasRect = canvas.getBoundingClientRect();
                let rootRect = this.$root.getBoundingClientRect();
                this.setState({ offset: { x: rootRect.left - canvasRect.left,y: rootRect.top - canvasRect.top } })
              } catch(e) {
              }
            }, 0),

            draw() {
                // TODO re-renders each time!?
                this.state.annotations.forEach(a=> { this.drawAnnotation(a) });

                // first, position the canvas
                let canvasRect = this.$root.getBoundingClientRect();
                let canvas = {};
                canvas.top = this.$root.offsetTop;
                canvas.left = this.$root.offsetLeft;
                canvas.width = canvasRect.width;
                canvas.height = canvasRect.height;

                if (this.state.offset == null) {
                    this.accountForOffsets();
                }

                this.setState({ canvas: canvas });

                let rects = [];
                this.state.annotations.forEach(a=> {
                    a.rects.forEach(r=> {
                        if (!r) return; // why would this happen?
                        rects.push({
                            x: r.x - 2,
                            y: r.y - 2,
                            width: r.width,
                            height: r.height,
                            id: a.id,
                            tag: a.tag,
                        });
                    });
                    // cleanup so rects doesn't get saved
                    a.rects = null;
                });

                this.setState({ highlights: rects });

                this.setZIndices();
            },

            drawAnnotation(annotation) {
              annotation.rects = [];

              let obj = JSON.parse(annotation.range)
              let range = null;
              try {
                range = toRange(obj.start, obj.startOffset, obj.end, obj.endOffset, this.$root);
              } catch(e) {
                // document modified?
                // mark for removal?
                return;
              }

              let bound = this.$root.getBoundingClientRect();

              // use X,Y
              bound.x = bound.x || bound.left;
              bound.y = bound.y || bound.top;

              let rects = range.getClientRects();
              for(let i=0;i<rects.length;i++) {
                let rect = rects.item(i);

                // use X,Y
                rect.x = rect.x || rect.left;
                rect.y = rect.y || rect.top;

                // make relative
                rect.y = rect.y - bound.y;
                rect.x = rect.x - bound.x;
                annotation.rects.push(rect);
              }
            },

            requestMenu(menu) {
              if (this.state.subMenu == menu) {
                menu = ''; // toggle
              }
              this.setState({ subMenu: menu });
            },

            openShareLink(event) {
              event.preventDefault();
              window.open(event.srcElement.href, '', 
                'menubar=no,toolbar=no,resizable=yes,scrollbars=yes,height=300,width=600');
            }
        });
    }

    render(props, state) {
        let showCreateUI = (state.menu == 'create' && state.selection!=null);
        let showEditUI = (state.menu == 'edit' && state.focus!=null);
        let showAnyUI = showCreateUI | showEditUI;
        return <div>
            <Debug
                menu={state.menu + (state.subMenu ? '-' + state.subMenu : '')}
                focus={state.focus}
                selection={state.selection}
                range={state.range}
                bounds={state.selectionBounds}
                annotations={state.annotations}
            ></Debug>

            <Highlights
                focus={state.focus}
                offset={state.offset}
                canvas={state.canvas}
                highlights={state.highlights}>
            </Highlights>

            <Icons></Icons>

            {showAnyUI ? <UI menu={state.menu} subMenu={state.subMenu}></UI> : <div></div>}
        </div>;
    }
}

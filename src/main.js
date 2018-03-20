import { h, render, Component } from 'preact';
import App from './App.js';
import Axios from 'Axios';
import './assets/main.scss';

Component.prototype.$http = Axios;
Component.prototype.$api = {};
Component.prototype.$config = {
  selector: [ 'article' ],
  debug: true,
  // svg: true,
  mobile: false
};

if (typeof(window.annot8Config) == 'object') {
  Component.prototype.$config = Object.assign(Component.prototype.$config, window.annot8Config);
}

try {
    var navigator = window.navigator;
    Component.prototype.$config.mobile = ( navigator.userAgent.match(/Android/i)
      || navigator.userAgent.match(/webOS/i)
      || navigator.userAgent.match(/iPhone/i)
      || navigator.userAgent.match(/iPad/i)
      || navigator.userAgent.match(/iPod/i)
      || navigator.userAgent.match(/BlackBerry/i)
      || navigator.userAgent.match(/Windows Phone/i)
    );
    // Component.prototype.$config.mobile = true;
} catch(e) {
}

render(<App />, document.querySelector('#annot8-app'));
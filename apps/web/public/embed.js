/*!
 * Proactivity embed loader. Drop one of these onto a partner page:
 *
 *   <div data-proactivity-embed
 *        data-key="pa_xxx"
 *        data-location="lake-anna"
 *        data-radius-mi="25"
 *        data-days="7"></div>
 *   <script src="https://proactivity.app/embed.js" async></script>
 *
 * Or with explicit lat/lng instead of a preset:
 *
 *   <div data-proactivity-embed
 *        data-key="pa_xxx"
 *        data-lat="37.989" data-lng="-77.886"
 *        data-radius-mi="25"></div>
 *
 * Optional attrs: data-limit, data-categories, data-theme (light|dark|auto).
 *
 * The script scans for matching divs, injects an iframe per div pointing
 * at proactivity.app/embed, and listens for proactivity:resize postMessage
 * events from each iframe so the embed expands to fit its content.
 */
(function () {
  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;
  var EMBED_HOST = new URL(SCRIPT.src).origin;

  // attribute name on the div → query param sent to /embed
  var ATTR_MAP = {
    'key': 'key',
    'location': 'location',
    'lat': 'lat',
    'lng': 'lng',
    'radius-mi': 'radiusMi',
    'days': 'days',
    'limit': 'limit',
    'categories': 'categories',
    'theme': 'theme',
  };

  function mount(node) {
    if (node.getAttribute('data-proactivity-loaded') === '1') return;
    node.setAttribute('data-proactivity-loaded', '1');

    var params = new URLSearchParams();
    Object.keys(ATTR_MAP).forEach(function (a) {
      var v = node.getAttribute('data-' + a);
      if (v != null && v !== '') params.set(ATTR_MAP[a], v);
    });

    var iframe = document.createElement('iframe');
    iframe.src = EMBED_HOST + '/embed?' + params.toString();
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.minHeight = '200px';
    iframe.style.display = 'block';
    iframe.setAttribute('title', 'Proactivity events');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('allow', 'clipboard-write');
    node.appendChild(iframe);
  }

  function scan() {
    var nodes = document.querySelectorAll('[data-proactivity-embed]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  // Auto-resize iframes when they tell us their content height.
  window.addEventListener('message', function (e) {
    if (e.origin !== EMBED_HOST) return;
    if (!e.data || e.data.type !== 'proactivity:resize') return;
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      if (iframes[i].contentWindow === e.source) {
        iframes[i].style.height = e.data.height + 'px';
        return;
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }
})();

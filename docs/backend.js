// Which Supabase project a patient page talks to. Links from the app carry
// ?p=<project ref> (supabase/functions/_shared/publicPages.ts), so the same
// static pages serve development and production. Only projects listed here are
// accepted — a link can't make a page send its token anywhere else. The first
// entry is used for links sent before ?p existed (all from development).
// Add the production project's ref here when it's created.
(function () {
  var ALLOWED_PROJECTS = ['aqubyxhudwxhfkhihgtk'];
  var requested = new URLSearchParams(location.search).get('p');
  var ref = ALLOWED_PROJECTS.indexOf(requested) >= 0 ? requested : ALLOWED_PROJECTS[0];
  window.dcFunctionUrl = function (name) {
    return 'https://' + ref + '.supabase.co/functions/v1/' + name;
  };
})();

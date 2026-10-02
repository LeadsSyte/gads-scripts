<?php
/**
 * Plugin Name: Syte SEO Helper
 * Description: Lets the Syte SEO Suite make small, reversible SEO fixes that live in a site's theme rather than in a post: heading levels, redirects, canonical and robots tags, structured data, titles and descriptions for pages without an editor, and added sections on page-builder pages. Nothing in the theme or the database content is edited — each fix is a rule applied as the page is served, and removing the rule undoes it.
 * Version: 1.0.0
 * Author: Syte Digital
 * Requires at least: 5.6
 * Requires PHP: 7.2
 */

if (!defined('ABSPATH')) { exit; }

define('SYTE_SEO_HELPER_VERSION', '1.0.0');
define('SYTE_SEO_RULES_OPTION', 'syte_seo_rules');

/* -------------------------------------------------------------------------
 * Rules: stored as one option, keyed by id.
 *   { id, type, path, enabled, preview, ...type fields, updated }
 * path is a site path ("/about/") or "*" for every page.
 * A rule that is not enabled only applies to a request carrying its preview
 * token (?syte_preview=<token>) — that is how a change is previewed on the
 * real page before anyone else can see it.
 * ---------------------------------------------------------------------- */

function syte_seo_rules() {
  $rules = get_option(SYTE_SEO_RULES_OPTION, array());
  return is_array($rules) ? $rules : array();
}

function syte_seo_norm_path($path) {
  $path = '/' . trim((string) $path, "/ \t\n\r");
  return $path === '/' ? '/' : $path . '/';
}

function syte_seo_text($html) {
  $t = html_entity_decode(wp_strip_all_tags((string) $html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  $t = preg_replace('/\s+/u', ' ', $t);
  return function_exists('mb_strtolower') ? mb_strtolower(trim($t), 'UTF-8') : strtolower(trim($t));
}

function syte_seo_types() {
  return array('heading', 'redirect', 'canonical', 'robots', 'schema', 'title', 'description', 'insert_html');
}

/** Validate and clean one rule coming from the suite. Returns the rule or a WP_Error. */
function syte_seo_clean_rule($id, $in) {
  $in = is_array($in) ? $in : array();
  $type = isset($in['type']) ? (string) $in['type'] : '';
  if (!in_array($type, syte_seo_types(), true)) { return new WP_Error('syte_bad_type', 'Unknown rule type.', array('status' => 400)); }

  $path = isset($in['path']) ? trim((string) $in['path']) : '';
  if ($path !== '*') {
    $parsed = wp_parse_url($path, PHP_URL_PATH);
    if ($parsed === null || $parsed === false || $parsed === '') { return new WP_Error('syte_bad_path', 'A rule needs a page path, or * for every page.', array('status' => 400)); }
    $path = syte_seo_norm_path($parsed);
    if (preg_match('#^/(wp-admin|wp-login\.php|wp-json)(/|$)#', $path)) { return new WP_Error('syte_bad_path', 'That path is not a public page.', array('status' => 400)); }
  }

  $rule = array(
    'id' => $id, 'type' => $type, 'path' => $path,
    'enabled' => !empty($in['enabled']),
    'preview' => isset($in['preview']) && preg_match('/^[a-f0-9]{16,64}$/', (string) $in['preview']) ? (string) $in['preview'] : '',
    'note' => isset($in['note']) ? sanitize_text_field((string) $in['note']) : '',
    'updated' => gmdate('c'),
  );
  $str = function ($key, $max = 400) use ($in) { return isset($in[$key]) ? trim(mb_substr((string) $in[$key], 0, $max)) : ''; };

  switch ($type) {
    case 'heading':
      $mode = $str('mode');
      if (!in_array($mode, array('demote', 'promote', 'keep_one'), true)) { return new WP_Error('syte_bad_rule', 'heading.mode must be demote, promote or keep_one.', array('status' => 400)); }
      $rule['mode'] = $mode;
      $rule['text'] = $str('text', 300);
      $rule['to'] = max(1, min(6, isset($in['to']) ? (int) $in['to'] : ($mode === 'promote' ? 1 : 2)));
      if ($mode !== 'keep_one' && $rule['text'] === '') { return new WP_Error('syte_bad_rule', 'heading needs the text of the heading to change.', array('status' => 400)); }
      break;
    case 'redirect':
      if ($path === '*' || $path === '/') { return new WP_Error('syte_bad_rule', 'A redirect needs one specific page, not the home page or every page.', array('status' => 400)); }
      $to = esc_url_raw($str('to', 600));
      if (!$to || !preg_match('#^https?://#i', $to)) { return new WP_Error('syte_bad_rule', 'redirect.to must be a full http(s) address.', array('status' => 400)); }
      $rule['to'] = $to;
      $rule['code'] = isset($in['code']) && (int) $in['code'] === 302 ? 302 : 301;
      break;
    case 'canonical':
      $url = esc_url_raw($str('url', 600));
      if (!$url || !preg_match('#^https?://#i', $url)) { return new WP_Error('syte_bad_rule', 'canonical.url must be a full http(s) address.', array('status' => 400)); }
      if ($path === '*') { return new WP_Error('syte_bad_rule', 'A canonical rule needs one specific page.', array('status' => 400)); }
      $rule['url'] = $url;
      break;
    case 'robots':
      $value = $str('value');
      if (!in_array($value, array('index', 'noindex'), true)) { return new WP_Error('syte_bad_rule', 'robots.value must be index or noindex.', array('status' => 400)); }
      if ($path === '*') { return new WP_Error('syte_bad_rule', 'A robots rule needs one specific page.', array('status' => 400)); }
      $rule['value'] = $value;
      break;
    case 'schema':
      $json = isset($in['json']) ? (is_string($in['json']) ? $in['json'] : wp_json_encode($in['json'])) : '';
      $decoded = json_decode($json, true);
      if (!is_array($decoded)) { return new WP_Error('syte_bad_rule', 'schema.json is not valid JSON.', array('status' => 400)); }
      $rule['json'] = wp_json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
      break;
    case 'title':
    case 'description':
      $value = $str('value', 400);
      if ($value === '') { return new WP_Error('syte_bad_rule', $type . ' needs a value.', array('status' => 400)); }
      if ($path === '*') { return new WP_Error('syte_bad_rule', 'A ' . $type . ' rule needs one specific page.', array('status' => 400)); }
      $rule['value'] = sanitize_text_field($value);
      break;
    case 'insert_html':
      $position = $str('position');
      if (!in_array($position, array('after_h1', 'end_of_main'), true)) { return new WP_Error('syte_bad_rule', 'insert_html.position must be after_h1 or end_of_main.', array('status' => 400)); }
      if ($path === '*') { return new WP_Error('syte_bad_rule', 'An added section needs one specific page.', array('status' => 400)); }
      $html = isset($in['html']) ? (string) $in['html'] : '';
      // Structured data may ride along; anything else scripted is dropped.
      $schemas = array();
      if (preg_match_all('#<script[^>]*application/ld\+json[^>]*>(.*?)</script>#is', $html, $m)) {
        foreach ($m[1] as $block) {
          $d = json_decode(trim($block), true);
          if (is_array($d)) { $schemas[] = wp_json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); }
        }
      }
      $html = preg_replace('#<script\b.*?</script>#is', '', $html);
      $html = preg_replace('#<style\b.*?</style>#is', '', $html);
      $html = trim(wp_kses_post($html));
      if (strlen($html) < 20 && !$schemas) { return new WP_Error('syte_bad_rule', 'insert_html has nothing to add.', array('status' => 400)); }
      $rule['position'] = $position;
      $rule['html'] = $html;
      $rule['schemas'] = $schemas;
      break;
  }
  return $rule;
}

/* -------------------------------------------------------------------------
 * REST: /wp-json/syte/v1 — administrators only (the suite signs in with an
 * application password).
 * ---------------------------------------------------------------------- */

add_action('rest_api_init', function () {
  $admin = function () { return current_user_can('manage_options'); };
  $id_arg = array('id' => array('validate_callback' => function ($v) { return (bool) preg_match('/^[A-Za-z0-9_-]{1,80}$/', (string) $v); }));

  register_rest_route('syte/v1', '/status', array(
    'methods' => 'GET', 'permission_callback' => $admin,
    'callback' => function () {
      $rules = syte_seo_rules();
      return array(
        'plugin' => 'syte-seo-helper', 'version' => SYTE_SEO_HELPER_VERSION, 'types' => syte_seo_types(),
        'rules' => count($rules), 'enabled' => count(array_filter($rules, function ($r) { return !empty($r['enabled']); })),
        'seo_plugin' => defined('WPSEO_VERSION') ? 'yoast' : (defined('RANK_MATH_VERSION') ? 'rankmath' : 'none'),
        'home' => home_url('/'),
      );
    },
  ));

  register_rest_route('syte/v1', '/rules', array(
    'methods' => 'GET', 'permission_callback' => $admin,
    'callback' => function () { return array_values(syte_seo_rules()); },
  ));

  register_rest_route('syte/v1', '/rules/(?P<id>[A-Za-z0-9_-]{1,80})', array(
    array(
      'methods' => 'GET', 'permission_callback' => $admin, 'args' => $id_arg,
      'callback' => function ($req) {
        $rules = syte_seo_rules();
        return isset($rules[$req['id']]) ? $rules[$req['id']] : new WP_Error('syte_not_found', 'No such rule.', array('status' => 404));
      },
    ),
    array(
      'methods' => 'PUT, POST', 'permission_callback' => $admin, 'args' => $id_arg,
      'callback' => function ($req) {
        $rule = syte_seo_clean_rule($req['id'], $req->get_json_params());
        if (is_wp_error($rule)) { return $rule; }
        $rules = syte_seo_rules();
        $rules[$req['id']] = $rule;
        update_option(SYTE_SEO_RULES_OPTION, $rules, true);
        if ($rule['enabled']) { syte_seo_purge_caches(); }
        return $rule;
      },
    ),
    array(
      'methods' => 'DELETE', 'permission_callback' => $admin, 'args' => $id_arg,
      'callback' => function ($req) {
        $rules = syte_seo_rules();
        $was = isset($rules[$req['id']]) ? $rules[$req['id']] : null;
        unset($rules[$req['id']]);
        update_option(SYTE_SEO_RULES_OPTION, $rules, true);
        if ($was && !empty($was['enabled'])) { syte_seo_purge_caches(); }
        return array('deleted' => (bool) $was);
      },
    ),
  ));
});

/** Ask the common page caches to drop what they hold. Best effort. */
function syte_seo_purge_caches() {
  if (function_exists('rocket_clean_domain')) { @rocket_clean_domain(); }
  if (function_exists('w3tc_flush_all')) { @w3tc_flush_all(); }
  if (function_exists('wp_cache_clear_cache')) { @wp_cache_clear_cache(); }
  if (class_exists('autoptimizeCache') && method_exists('autoptimizeCache', 'clearall')) { @autoptimizeCache::clearall(); }
  do_action('litespeed_purge_all');
  do_action('wpfc_clear_all_cache');
  do_action('breeze_clear_all_cache');
  if (function_exists('sg_cachepress_purge_cache')) { @sg_cachepress_purge_cache(); }
  wp_cache_flush();
}

/* -------------------------------------------------------------------------
 * The SEO title / description fields of Yoast and Rank Math, made writable
 * through the REST API (this replaces the separate code snippet).
 * ---------------------------------------------------------------------- */

add_action('init', function () {
  $keys = array('_yoast_wpseo_title', '_yoast_wpseo_metadesc', 'rank_math_title', 'rank_math_description');
  foreach (get_post_types(array('public' => true)) as $type) {
    foreach ($keys as $key) {
      register_post_meta($type, $key, array(
        'show_in_rest' => true, 'single' => true, 'type' => 'string',
        'auth_callback' => function () { return current_user_can('edit_posts'); },
      ));
    }
  }
}, 99);

/* -------------------------------------------------------------------------
 * Applying rules to a page as it is served.
 * ---------------------------------------------------------------------- */

/** Rules that apply to this request: enabled ones, plus one being previewed. */
function syte_seo_rules_for_request() {
  static $found = null;
  if ($found !== null) { return $found; }
  $found = array();
  if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST) || (defined('XMLRPC_REQUEST') && XMLRPC_REQUEST) || (defined('DOING_CRON') && DOING_CRON)) { return $found; }
  $uri = isset($_SERVER['REQUEST_URI']) ? (string) wp_unslash($_SERVER['REQUEST_URI']) : '/';
  $path = syte_seo_norm_path((string) wp_parse_url($uri, PHP_URL_PATH));
  // A site in a sub-folder: compare paths relative to the site's home.
  $home_path = syte_seo_norm_path((string) wp_parse_url(home_url('/'), PHP_URL_PATH));
  $token = isset($_GET['syte_preview']) ? preg_replace('/[^a-f0-9]/', '', (string) wp_unslash($_GET['syte_preview'])) : '';
  foreach (syte_seo_rules() as $rule) {
    $on = !empty($rule['enabled']) || ($token !== '' && !empty($rule['preview']) && hash_equals((string) $rule['preview'], $token));
    if (!$on) { continue; }
    if ($rule['path'] !== '*') {
      $want = syte_seo_norm_path($rule['path']);
      if ($want !== $path && syte_seo_norm_path(rtrim($home_path, '/') . $want) !== $path) { continue; }
    }
    $found[] = $rule;
  }
  return $found;
}

add_action('template_redirect', function () {
  $rules = syte_seo_rules_for_request();
  if (!$rules) { return; }

  // A previewed page must never be stored by a page cache.
  if (isset($_GET['syte_preview'])) {
    if (!defined('DONOTCACHEPAGE')) { define('DONOTCACHEPAGE', true); }
    nocache_headers();
  }

  foreach ($rules as $rule) {
    if ($rule['type'] !== 'redirect') { continue; }
    // Never redirect a page to itself.
    $to_path = syte_seo_norm_path((string) wp_parse_url($rule['to'], PHP_URL_PATH));
    $to_host = (string) wp_parse_url($rule['to'], PHP_URL_HOST);
    $here = syte_seo_norm_path((string) wp_parse_url((string) wp_unslash($_SERVER['REQUEST_URI']), PHP_URL_PATH));
    $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
    if ($to_path === $here && ($to_host === '' || strcasecmp($to_host, $host) === 0)) { continue; }
    wp_redirect($rule['to'], (int) $rule['code'], 'Syte SEO Helper');
    exit;
  }

  if (is_feed() || is_robots() || is_trackback()) { return; }
  ob_start('syte_seo_filter_html');
}, 0);

/** One pass over the finished page. */
function syte_seo_filter_html($html) {
  if (!is_string($html) || stripos($html, '<html') === false || stripos($html, '</head>') === false) { return $html; }
  $rules = syte_seo_rules_for_request();
  $head = '';
  $headings = array();

  foreach ($rules as $rule) {
    switch ($rule['type']) {
      case 'title':
        $new = '<title>' . esc_html($rule['value']) . '</title>';
        $count = 0;
        $html = preg_replace('#<title\b[^>]*>.*?</title>#is', addcslashes($new, '\\$'), $html, 1, $count);
        if (!$count) { $head .= $new . "\n"; }
        break;
      case 'description':
        $new = '<meta name="description" content="' . esc_attr($rule['value']) . '" />';
        $count = 0;
        $html = preg_replace('#<meta\b[^>]*\bname=["\']description["\'][^>]*>#i', addcslashes($new, '\\$'), $html, 1, $count);
        if (!$count) { $head .= $new . "\n"; }
        break;
      case 'canonical':
        $new = '<link rel="canonical" href="' . esc_url($rule['url']) . '" />';
        $html = preg_replace('#<link\b[^>]*\brel=["\']canonical["\'][^>]*>\s*#i', '', $html);
        $head .= $new . "\n";
        break;
      case 'robots':
        $new = '<meta name="robots" content="' . ($rule['value'] === 'noindex' ? 'noindex, follow' : 'index, follow') . '" />';
        $html = preg_replace('#<meta\b[^>]*\bname=["\']robots["\'][^>]*>\s*#i', '', $html);
        $head .= $new . "\n";
        break;
      case 'schema':
        $head .= '<script type="application/ld+json" data-syte="' . esc_attr($rule['id']) . '">' . $rule['json'] . '</script>' . "\n";
        break;
      case 'heading':
        $headings[] = $rule;
        break;
    }
  }

  if ($headings) { $html = syte_seo_apply_headings($html, $headings); }

  foreach ($rules as $rule) {
    if ($rule['type'] !== 'insert_html') { continue; }
    $block = "\n<!-- syte:" . $rule['id'] . " -->\n" . $rule['html'];
    foreach ((array) $rule['schemas'] as $json) { $block .= "\n" . '<script type="application/ld+json">' . $json . '</script>'; }
    $block .= "\n<!-- /syte:" . $rule['id'] . " -->\n";
    $html = syte_seo_insert($html, $block, $rule['position']);
  }

  if ($head !== '') {
    $pos = stripos($html, '</head>');
    $html = substr($html, 0, $pos) . $head . substr($html, $pos);
  }
  return $html;
}

function syte_seo_insert($html, $block, $position) {
  if ($position === 'after_h1') {
    $pos = stripos($html, '</h1>');
    if ($pos !== false) { return substr($html, 0, $pos + 5) . $block . substr($html, $pos + 5); }
    $position = 'end_of_main';
  }
  foreach (array('</main>', '<footer') as $needle) {
    $pos = strripos($html, $needle);
    if ($pos !== false) { return substr($html, 0, $pos) . $block . substr($html, $pos); }
  }
  $pos = strripos($html, '</body>');
  return $pos === false ? $html . $block : substr($html, 0, $pos) . $block . substr($html, $pos);
}

/** Change heading levels. Only the tag changes; classes and content stay. */
function syte_seo_apply_headings($html, $rules) {
  // Leave anything inside <script>, <style>, <textarea> or comments alone.
  $parts = preg_split('#(<script\b.*?</script>|<style\b.*?</style>|<textarea\b.*?</textarea>|<!--.*?-->)#is', $html, -1, PREG_SPLIT_DELIM_CAPTURE);
  foreach ($rules as $rule) {
    $want = syte_seo_text($rule['text']);
    $to = (int) $rule['to'];
    $state = array('h1_seen' => 0, 'kept' => false, 'promoted' => false, 'has_h1' => false);
    if ($rule['mode'] === 'demote') {
      // Only where the page has more than one main heading. On a page where
      // this heading is the ONLY H1 (e.g. the news listing itself) it stays.
      $h1s = 0;
      foreach ($parts as $i => $part) { if ($i % 2 === 0) { $h1s += preg_match_all('#<h1\b#i', $part); } }
      if ($h1s < 2) { continue; }
    }
    if ($rule['mode'] === 'promote') {
      foreach ($parts as $i => $part) { if ($i % 2 === 0 && preg_match('#<h1\b#i', $part)) { $state['has_h1'] = true; break; } }
      if ($state['has_h1']) { continue; } // the page has its main heading already
    }
    if ($rule['mode'] === 'keep_one' && $want !== '') {
      // Which H1 to keep: the first whose text matches; if none matches, the first one.
      $state['match_exists'] = false;
      foreach ($parts as $i => $part) {
        if ($i % 2 === 0 && preg_match_all('#<h1\b[^>]*>(.*?)</h1>#is', $part, $m)) {
          foreach ($m[1] as $inner) { if (syte_seo_text($inner) === $want) { $state['match_exists'] = true; break 2; } }
        }
      }
    }
    foreach ($parts as $i => $part) {
      if ($i % 2 === 1) { continue; }
      $parts[$i] = preg_replace_callback('#<h([1-6])\b([^>]*)>(.*?)</h\1>#is', function ($m) use ($rule, $want, $to, &$state) {
        $level = (int) $m[1];
        $text = syte_seo_text($m[3]);
        $retag = function ($n) use ($m) { return '<h' . $n . $m[2] . '>' . $m[3] . '</h' . $n . '>'; };
        if ($rule['mode'] === 'demote') {
          return ($level === 1 && $text === $want) ? $retag(max(2, $to)) : $m[0];
        }
        if ($rule['mode'] === 'promote') {
          if (!$state['promoted'] && $level !== 1 && $text === $want) { $state['promoted'] = true; return $retag(1); }
          return $m[0];
        }
        // keep_one
        if ($level !== 1) { return $m[0]; }
        $state['h1_seen']++;
        $is_keeper = !$state['kept'] && ($want === '' || empty($state['match_exists']) ? $state['h1_seen'] === 1 : $text === $want);
        if ($is_keeper) { $state['kept'] = true; return $m[0]; }
        return $retag(max(2, $to));
      }, $part);
    }
  }
  return implode('', $parts);
}

/* -------------------------------------------------------------------------
 * A line on the Plugins screen, so a site owner can see what is active.
 * ---------------------------------------------------------------------- */

add_filter('plugin_row_meta', function ($links, $file) {
  if ($file === plugin_basename(__FILE__)) {
    $rules = syte_seo_rules();
    $on = count(array_filter($rules, function ($r) { return !empty($r['enabled']); }));
    $links[] = esc_html($on . ' fix' . ($on === 1 ? '' : 'es') . ' active (managed from the Syte SEO Suite). Deactivating the plugin switches them all off.');
  }
  return $links;
}, 10, 2);

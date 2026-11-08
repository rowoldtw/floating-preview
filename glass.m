// Liquid Glass behind an Electron window's page: a Node module (N-API) for
// Electron's main process, which Electron's own vibrancy can't do (its
// materials blur so heavily that nothing behind reads through).
//
//   glass.apply(win.getNativeWindowHandle(), { radius, clear, tint, alpha, blur, material })
//
// clear: Liquid Glass's clear style (else regular). blur: a plain macOS blur
// (material: an NSVisualEffectMaterial number) instead of glass, always
// drawn as if the window were active. alpha: how strongly it's drawn; below
// 1 the sharp desktop shows through it, for a lighter, see-through look.
//   glass.remove(win.getNativeWindowHandle())
//   glass.preventActivation(win.getNativeWindowHandle())
//
// Build: clang -bundle -undefined dynamic_lookup -fobjc-arc -framework AppKit
//        glass.m -o glass.node
#import <AppKit/AppKit.h>

typedef struct napi_env__* napi_env;
typedef struct napi_value__* napi_value;
typedef struct napi_callback_info__* napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
extern napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t*, napi_value*, napi_value*, void**);
extern napi_status napi_get_buffer_info(napi_env, napi_value, void**, size_t*);
extern napi_status napi_get_named_property(napi_env, napi_value, const char*, napi_value*);
extern napi_status napi_get_value_double(napi_env, napi_value, double*);
extern napi_status napi_get_value_bool(napi_env, napi_value, bool*);
extern napi_status napi_create_function(napi_env, const char*, size_t, napi_callback, void*, napi_value*);
extern napi_status napi_set_named_property(napi_env, napi_value, const char*, napi_value);
extern napi_status napi_get_boolean(napi_env, bool, napi_value*);

static NSString* const kId = @"floating-preview-glass";

static NSView* viewFrom(napi_env env, napi_value buffer) {
  void* data = NULL;
  size_t length = 0;
  if (napi_get_buffer_info(env, buffer, &data, &length) != 0 || length < sizeof(void*)) return nil;
  return (__bridge NSView*)(*(void**)data);
}

static double number(napi_env env, napi_value options, const char* key, double fallback) {
  napi_value v;
  double d;
  if (napi_get_named_property(env, options, key, &v) == 0 && napi_get_value_double(env, v, &d) == 0) return d;
  return fallback;
}

static bool flag(napi_env env, napi_value options, const char* key, bool fallback) {
  napi_value v;
  bool b;
  if (napi_get_named_property(env, options, key, &v) == 0 && napi_get_value_bool(env, v, &b) == 0) return b;
  return fallback;
}

static NSView* existing(NSView* root) {
  for (NSView* v in root.subviews)
    if ([v.identifier isEqualToString:kId]) return v;
  return nil;
}

static napi_value result(napi_env env, bool ok) {
  napi_value r;
  napi_get_boolean(env, ok, &r);
  return r;
}

static napi_value apply(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView* view = argc > 0 ? viewFrom(env, argv[0]) : nil;
  NSWindow* window = view.window;
  if (!window) return result(env, false);
  NSView* root = window.contentView;
  [existing(root) removeFromSuperview];
  napi_value o = argc > 1 ? argv[1] : NULL;
  double radius = o ? number(env, o, "radius", 16) : 16;
  NSView* layerView;
  if (o && flag(env, o, "blur", false)) {
    NSVisualEffectView* blur = [[NSVisualEffectView alloc] initWithFrame:root.bounds];
    blur.material = (NSVisualEffectMaterial)number(env, o, "material", NSVisualEffectMaterialHUDWindow);
    blur.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    blur.state = NSVisualEffectStateActive;
    blur.wantsLayer = YES;
    blur.layer.cornerRadius = radius;
    blur.layer.cornerCurve = kCACornerCurveContinuous;
    blur.layer.masksToBounds = YES;
    layerView = blur;
  } else if (@available(macOS 26.0, *)) {
    NSGlassEffectView* glass = [[NSGlassEffectView alloc] initWithFrame:root.bounds];
    glass.cornerRadius = radius;
    glass.style = (!o || flag(env, o, "clear", true)) ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
    double tint = o ? number(env, o, "tint", 0) : 0;
    glass.tintColor = tint > 0 ? [NSColor colorWithWhite:0 alpha:tint] : nil;
    layerView = glass;
  } else {
    return result(env, false);  // Liquid Glass needs macOS 26
  }
  // Glass adapts to what's behind it, flipping between a light and a dark
  // look as that changes; held to the dark look, it stays put.
  NSAppearance* dark = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  layerView.appearance = dark;
  window.appearance = dark;
  layerView.identifier = kId;
  layerView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  layerView.alphaValue = o ? number(env, o, "alpha", 1) : 1;
  [root addSubview:layerView positioned:NSWindowBelow relativeTo:nil];
  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.hasShadow = YES;
  [window invalidateShadow];
  return result(env, true);
}

static napi_value removeGlass(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSView* view = argc > 0 ? viewFrom(env, argv[0]) : nil;
  NSView* glass = view.window ? existing(view.window.contentView) : nil;
  [glass removeFromSuperview];
  return result(env, glass != nil);
}

// Clicking the window doesn't bring its app forward (like a floating panel),
// through AppKit's private _setPreventsActivation:, when it's there.
static napi_value preventActivation(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  NSWindow* window = argc > 0 ? viewFrom(env, argv[0]).window : nil;
  SEL sel = NSSelectorFromString(@"_setPreventsActivation:");
  if (!window || ![window respondsToSelector:sel]) return result(env, false);
  void (*set)(id, SEL, BOOL) = (void (*)(id, SEL, BOOL))[window methodForSelector:sel];
  set(window, sel, YES);
  return result(env, true);
}

__attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "apply", 5, apply, NULL, &fn);
  napi_set_named_property(env, exports, "apply", fn);
  napi_create_function(env, "remove", 6, removeGlass, NULL, &fn);
  napi_set_named_property(env, exports, "remove", fn);
  napi_create_function(env, "preventActivation", 17, preventActivation, NULL, &fn);
  napi_set_named_property(env, exports, "preventActivation", fn);
  return exports;
}

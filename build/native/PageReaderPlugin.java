package com.carddex.app;

import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * Opens a web page in a hidden browser view (a real Chrome engine, so sites that
 * block plain app requests — like eBay — still answer) and returns its HTML once
 * the page has what we're waiting for.
 */
@CapacitorPlugin(name = "PageReader")
public class PageReaderPlugin extends Plugin {

    @PluginMethod
    public void read(PluginCall call) {
        final String url = call.getString("url");
        final String ready = call.getString("ready", "body");
        final int timeout = call.getInt("timeout", 25000);
        if (url == null) { call.reject("No address"); return; }
        final Handler ui = new Handler(Looper.getMainLooper());
        ui.post(() -> {
            final WebView wv = new WebView(getContext());
            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setBlockNetworkImage(true);
            s.setLoadsImagesAutomatically(false);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true);
            wv.setWebViewClient(new WebViewClient());
            wv.setFocusable(false);
            wv.setVisibility(View.INVISIBLE);
            wv.setTranslationX(-20000);
            final ViewGroup root = (ViewGroup) getActivity().getWindow().getDecorView();
            root.addView(wv, new ViewGroup.LayoutParams(412, 900));
            final long start = System.currentTimeMillis();
            final boolean[] done = { false };
            final String js = "(function(){try{var ok=!!document.querySelector(" + JSONObjectQuote(ready) + ");"
                + "return (ok?'1':'0')+document.documentElement.outerHTML;}catch(e){return '0';}})()";
            final Runnable[] poll = new Runnable[1];
            poll[0] = () -> {
                if (done[0]) return;
                wv.evaluateJavascript(js, (value) -> {
                    if (done[0]) return;
                    String page = decode(value);
                    boolean ok = page.startsWith("1");
                    boolean late = System.currentTimeMillis() - start > timeout;
                    if (ok || late) {
                        done[0] = true;
                        JSObject ret = new JSObject();
                        ret.put("html", page.length() > 1 ? page.substring(1) : "");
                        ret.put("ready", ok);
                        ret.put("url", wv.getUrl());
                        call.resolve(ret);
                        root.removeView(wv);
                        wv.destroy();
                    } else {
                        ui.postDelayed(poll[0], 800);
                    }
                });
            };
            wv.loadUrl(url);
            ui.postDelayed(poll[0], 1500);
        });
    }

    private static String JSONObjectQuote(String s) {
        return org.json.JSONObject.quote(s);
    }

    private static String decode(String value) {
        if (value == null || value.equals("null")) return "";
        try { return new JSONArray("[" + value + "]").getString(0); } catch (Exception e) { return ""; }
    }
}

/**
 * MyFitnessPal bridge — implemented as bookmarklets, NOT a server integration.
 *
 * Why bookmarklets: MFP has no public OAuth/write API, and storing a user's
 * password server-side would be a standing security liability (and a ToS risk).
 * These snippets run entirely inside the user's own, already-authenticated MFP
 * tab, so session cookies and credentials never leave their browser and this
 * app stays fully stateless. Data crosses between the app and MFP via the URL
 * hash (pull) and the clipboard (track) — never the network.
 *
 * The DOM logic mirrors the Playwright client in src/mfp/client.ts
 * (`fetchRemainingMacros` and the macro-input tagging in `tagMacroInputs`).
 */

/** Compact clipboard token the "Track" bookmarklet reads. Order: cal,carbs,fat,protein. */
export const CLIPBOARD_PREFIX = 'MM1'

export function buildClipboardToken (m: {
    calories: number
    carbs: number
    fat: number
    protein: number
}): string {
    const r = (n: number) => Math.round(n * 10) / 10
    return `${CLIPBOARD_PREFIX}:${Math.round(m.calories)},${r(m.carbs)},${r(m.fat)},${r(m.protein)}`
}

/** Wraps source into a minified `javascript:` bookmarklet URL. */
function toBookmarklet (source: string): string {
    const body = source.replace(/\s*\n\s*/g, ' ').trim()
    return 'javascript:' + encodeURIComponent(`(()=>{${body}})()`)
}

/**
 * "Pull remaining → MacroPro": reads the MFP diary's "Remaining" row and sends
 * the four numbers to the app via the URL hash (#remaining=cal,protein,fat,carbs).
 */
export function pullRemainingBookmarklet (appUrl: string): string {
    const target = JSON.stringify(appUrl.replace(/\/$/, '') + '/#remaining=')
    return toBookmarklet(`
        var P=function(t){var m=String(t||'').replace(/,/g,'').match(/-?\\d+(?:\\.\\d+)?/);return m?parseFloat(m[0]):null};
        var rows=[].slice.call(document.querySelectorAll('tr'));
        for(var i=0;i<rows.length;i++){
            var c=[].slice.call(rows[i].querySelectorAll('td,th'));
            if(c.length<5)continue;
            var l=(c[0].textContent||'').trim().toLowerCase();
            if(l.indexOf('remaining')<0)continue;
            var cal=P(c[1].textContent),carbs=P(c[2].textContent),fat=P(c[3].textContent),prot=P(c[4].textContent);
            if(cal===null||carbs===null||fat===null||prot===null)break;
            location.href=${target}+[cal,prot,fat,carbs].join(',');
            return;
        }
        alert('MacroPro: could not find the "Remaining" row. Open your MyFitnessPal food diary first, then click this again.');
    `)
}

/**
 * "Track this meal → MFP": reads the meal from the clipboard (put there by the
 * app's "Track this meal" button) and autofills the macro/calorie inputs on the
 * MFP Quick Add form, matching fields by their labels.
 */
export function trackMealBookmarklet (): string {
    return toBookmarklet(`
        var run=function(txt){
            var m=String(txt||'').match(/MM1:(\\d+(?:\\.\\d+)?),(\\d+(?:\\.\\d+)?),(\\d+(?:\\.\\d+)?),(\\d+(?:\\.\\d+)?)/);
            if(!m){alert('MacroPro: no meal on the clipboard. Click "Track this meal" in MacroPro first, then come back here.');return;}
            var vals={calorie:m[1],carb:m[2],fat:m[3],protein:m[4]};
            var inputs=[].slice.call(document.querySelectorAll('input')).filter(function(i){return i.offsetParent!==null&&i.type!=='hidden'&&!i.disabled;});
            var cands=function(i){
                var a=[i.getAttribute('aria-label'),i.getAttribute('name'),i.getAttribute('placeholder')];
                if(i.id){var lb=document.querySelector('label[for=\"'+i.id+'\"]');if(lb)a.push(lb.textContent);}
                var p=i.parentElement,d=0;while(p&&d<4){[].slice.call(p.querySelectorAll('label')).forEach(function(l){a.push(l.textContent);});p=p.parentElement;d++;}
                return a.filter(function(x){return x;}).map(function(x){return x.trim();});
            };
            var setVal=function(i,v){
                var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
                if(s&&s.set){s.set.call(i,v);}else{i.value=v;}
                i.dispatchEvent(new Event('input',{bubbles:true}));
                i.dispatchEvent(new Event('change',{bubbles:true}));
            };
            var match=function(re){for(var k=0;k<inputs.length;k++){if(used.indexOf(inputs[k])>=0)continue;var cs=cands(inputs[k]);for(var j=0;j<cs.length;j++){if(re.test(cs[j]))return inputs[k];}}return null;};
            var used=[],filled=[];
            var order=[['calorie',/calorie|energy/i],['carb',/carb/i],['fat',/\\bfats?\\b/i],['protein',/protein/i]];
            for(var o=0;o<order.length;o++){var el=match(order[o][1]);if(el){setVal(el,vals[order[o][0]]);used.push(el);filled.push(order[o][0]);}}
            if(filled.length===0){alert('MacroPro: could not find the macro fields. Open the MFP Quick Add form (a meal → Quick Tools → Quick add calories), then click this again.');return;}
            alert('MacroPro: filled '+filled.join(', ')+'. Review the values and click "Add to Diary".');
        };
        if(navigator.clipboard&&navigator.clipboard.readText){navigator.clipboard.readText().then(run).catch(function(){run(prompt('Paste the meal copied from MacroPro:'));});}
        else{run(prompt('Paste the meal copied from MacroPro:'));}
    `)
}

/** Parses the `#remaining=cal,protein,fat,carbs` hash, if present. */
export function parseRemainingHash (
    hash: string
): { calories: number; protein: number; fat: number; carbs: number } | null {
    const m = hash.match(/remaining=([\d.]+),([\d.]+),([\d.]+),([\d.]+)/)
    if (!m) return null
    const [, cal, prot, fat, carbs] = m
    return {
        calories: Number(cal),
        protein: Number(prot),
        fat: Number(fat),
        carbs: Number(carbs)
    }
}

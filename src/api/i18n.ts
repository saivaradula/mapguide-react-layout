import * as logger from "../utils/logger";
import STRINGS_EN from "../strings/en";

const STRINGS: any = {
    "en": STRINGS_EN
};

/**
 * Registers a string bundle for the given locale
 *
 * @export
 * @param {string} locale
 * @param {*} bundle
 */
export function registerStringBundle(locale: string, bundle: any) {
    STRINGS[locale] = bundle;
}

/**
 * Formats the specified string and substitutes any placeholders (enclosed in {})
 * with the specified arguments
 *
 * @export
 * @param {string} format
 * @param {*} [args]
 * @returns {string}
 */
export function fmt(format: string, args?: any): string {
    let str = format;
    if (args != null) {
        for (const p in args) {
            //str = str.replace(new RegExp(`\{${p}\}`, "g"), `${args[p]}`);
            str = str.split(`{${p}}`).join(args[p]);
        }
        return str;
    };
    return str;
}


/**
 * Returns the localized string for the given key
 *
 * @export
 * @param {string} key
 * @param {string} [locale="en"]
 * @param {*} [args]
 * @returns {string}
 */
export function tr(key: string, locale = "en", args?: any): string {
    const bundle = STRINGS[locale];
    if (!bundle) {
        logger.warn(`No such string bundle for locale: ${locale}`);
        return key;
    } else {
        let str = bundle[key];
        if (!str) {
            logger.warn(`String bundle for locale (${locale}) is missing localized string for key: ${key}`);
            return key;
        } else {
            if (args != null) {
                return fmt(str, args);
            }
            return str;
        }
    }
}
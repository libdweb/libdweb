/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow strict
/* eslint spaced-comment: ["error", "always", { "markers": ["::", ":"], "exceptions":[":"] }] */
"use strict";

/*::
import { Cu, Cc, Cr, Ci, Components, ExtensionAPI, ChromeUtils, nsIMessageBroadcaster, nsIURI, nsILoadInfo } from "gecko";
*/

/*:: const { Services } =*/
ChromeUtils.defineModuleGetter(
  this,
  "Services",
  "resource://gre/modules/Services.jsm"
);
/*:: const { XPCOMUtils } =*/
ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

/*:: const { ExtensionUnils } = */
ChromeUtils.defineModuleGetter(
  this,
  "ExtensionUtils",
  "resource://gre/modules/ExtensionUtils.jsm"
);

/*:: const AppConstants =*/
ChromeUtils.defineModuleGetter(
  this,
  "AppConstants",
  "resource://gre/modules/AppConstants.jsm"
);

const EXPORTED_SYMBOLS = ["ProtocolUtil"];

class ProtocolUtil {
  static isPermitted(extension) {
    const value =
      AppConstants.NIGHTLY_BUILD ||
      AppConstants.MOZ_DEV_EDITION ||
      extension.isPrivileged;

    return value;
  }
  static isEnabled(extension) {
    return Services.prefs.getBoolPref(
      `libdweb.protocol.${extension.id}`,
      true
    );
  }
  static isSchemeAllowed(extension, scheme) {
    const protocols = extension.manifest.protocol;
    if (protocols) {
      for (const protocol of protocols) {
        if (protocol.scheme === scheme) {
          return true;
        }
      }
    }
    return false;
  }
  static ensurePermission(extension, scheme) {
    // if (!ProtocolUtil.isPermitted(extension)) {
    //   throw new ExtensionUtils.ExtensionError(
    //     "API is only available on nightly and dev edition"
    //   );
    // }
    // if (!ProtocolUtil.isEnabled(extension)) {
    //   throw new ExtensionUtils.ExtensionError(
    //     "Only whitelisted extensions can use protocol API."
    //   );
    // }
    // if (!ProtocolUtil.isSchemeAllowed(extension, scheme)) {
    //   throw new ExtensionUtils.ExtensionError(
    //     `Permission denied to register a protocol ${scheme} it needs to be present in manifest protocol`
    //   );
    // }
  }
}

/*:: export { ProtocolUtil } */

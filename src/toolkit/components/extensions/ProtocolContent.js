/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow strict
/* eslint spaced-comment: ["error", "always", { "markers": ["::", ":"], "exceptions":[":"] }] */
"use strict"

/*::
import { ChromeUtils, Components, Ci, Cr } from "gecko";
import type { nsIIDRef, nsIMessageListener, nsILoadInfo, nsIURI } from "gecko";
import type { Inn, Out, AgentOutbox, AgentInbox, ProtocolSpec, ResponseMessage, AgentOutboxMessage, RequestChannel } from "../../components/extensions/interface/protocol.js";
*/

// const PROTOCOL_COMMON = "resource://gre/modules/ProtocolCommon.jsm"
const PROTOCOL_COMMON = new URL(
  "./ProtocolCommon.jsm",
  Components.stack.filename
)

/*:: import * as ProtocolCommon from "./ProtocolCommon.jsm" */
ChromeUtils.defineModuleGetter(this, "ProtocolCommon", PROTOCOL_COMMON)

/*:: const { Services } = */
ChromeUtils.defineModuleGetter(
  this,
  "Services",
  "resource://gre/modules/Services.jsm"
)

const REQUESTOR_INBOX = `libdweb:protocol:requestor:inbox`
const REQUESTOR_OUTBOX = `libdweb:protocol:requestor:outbox`
const PROTOCOLS = `libdweb:protocol:protocols`

// `ProtocolRequestor` is loaded as a content process script & is used to
// manage active protocol registrations and sends messaages for requested
// resources to the `ProtocolService`, which routes them to a corresponding
// `ProtocolResponder` and routes response messages back to the issuing
// `ProtocolRequestor`. `ProtocolRequestor` manages active request
// channels and updates them as it receives corresponding response messages.
class ProtocolRequestor {
  /*::
  id: number;
  +pid: string;
  +requests: { [string]: RequestChannel };
  +protocols: {[string]:ProtocolSpec};
  */
  constructor() {
    this.id = 0
    this.pid = `Requestor${Services.appinfo.processID}`
    this.protocols = {}
    this.requests = {}
  }
  QueryInterface(iid /*: nsIIDRef<nsIMessageListener<any>> */) {
    if (iid.equals(Ci.nsISupports) || iid.equals(Ci.nsIMessageListener)) {
      return this
    }
    throw Cr.NS_ERROR_NO_INTERFACE
  }

  register(protocol /*: ProtocolSpec */) {
    const { protocols } = this

    if (protocols[protocol.scheme] == null) {
      protocols[protocol.scheme] = protocol
      ProtocolCommon.registerProtocol(protocol, this)
    }
  }
  unregister(protocol /*: ProtocolSpec*/) {
    const { protocols } = this
    if (protocols[protocol.scheme] != null) {
      delete protocols[protocol.scheme]
      ProtocolCommon.unregisterProtocol(protocol.scheme)
    }
  }
  receiveResponse(data /*: ResponseMessage*/) {
    const request = this.requests[data.id]
    if (request) {
      request.receiveResponse(data)
    } else {
      throw Error(`Request ${request.id} not found`)
    }
  }
  receiveMessage({ data } /*: AgentInbox */) {
    switch (data.type) {
      case "terminate":
        return this.terminate()
      case "unregister":
        return this.unregister(data)
      case "register":
        return this.register(data)
      default:
        return this.receiveResponse(data)
    }
  }
  send(message /*: AgentOutboxMessage*/) {
    Services.cpmm.sendAsyncMessage(REQUESTOR_OUTBOX, message)
  }

  newChannel(
    url /*: nsIURI */,
    loadInfo /*: nsILoadInfo */
  ) /*: RequestChannel */ {
    const id = `${url.scheme}:${++this.id}:${this.pid}`
    const request = ProtocolCommon.newChannel(this, url, loadInfo, id)
    this.requests[id] = request
    return request
  }

  terminate() {
    const { protocols, requests } = this
    Services.cpmm.removeMessageListener(REQUESTOR_INBOX, this)

    delete this.protocols

    for (const id in requests) {
      const request = requests[id]
      request.cancel()
    }

    for (const scheme in protocols) {
      ProtocolCommon.unregisterProtocol(scheme)
    }
  }

  activate() {
    Services.cpmm.addMessageListener(REQUESTOR_INBOX, this)

    const protocols /*: { [string]: ProtocolSpec } */ =
      Services.cpmm.initialProcessData[PROTOCOLS]

    if (protocols) {
      for (let scheme in protocols) {
        this.register(protocols[scheme])
      }
    }
  }
}

new ProtocolRequestor().activate()

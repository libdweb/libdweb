/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow strict
/* eslint spaced-comment: ["error", "always", { "markers": ["::", ":"], "exceptions":[":"] }] */
"use strict"

/*::
import { Cu, Cc, Cr, Ci, Components, ExtensionAPI, ChromeUtils, nsIMessageBroadcaster, nsIURI, nsILoadInfo } from "gecko";
import type { ProtocolSpec, Out, HandlerInbox, Port, AgentInboxMessage, AgentInbox, AgentOutbox, HandlerOutbox, RequestMessage, ResponseMessage, RegisterProtocol, UnregisterProtocol, RequestChannel, Service } from "../interface/protocol.js";
*/

try {
  /*:: const { Services } =*/
  ChromeUtils.defineModuleGetter(
    this,
    "Services",
    "resource://gre/modules/Services.jsm"
  )
  /*:: const { XPCOMUtils } =*/
  ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm")
  Components.utils.importGlobalProperties(["URL"])

  /*::
const uuidGen = Cc["@mozilla.org/uuid-generator;1"]
  .getService(Ci.nsIUUIDGenerator);
*/
  XPCOMUtils.defineLazyServiceGetters(this, {
    uuidGen: ["@mozilla.org/uuid-generator;1", "nsIUUIDGenerator"]
  })

  /*:: import { ProtocolUtil } from "../ProtocolUtil.jsm"*/
  // ChromeUtils.defineModuleGetter(
  //   this,
  //   "ProtocolUtil",
  //   "resource://gre/modules/ProtocolUtil.jsm"
  // );

  // const PROTOCOL_CONTENT = "resource://gre/modules/ProtocolContent.js";
  const PROTOCOL_CONTENT = new URL(
    `../ProtocolContent.js`,
    Components.stack.filename
  )
  // const PROTOCOL_COMMON = "resource://gre/modules/ProtocolCommon.jsm";
  const PROTOCOL_COMMON = new URL(
    "../ProtocolCommon.jsm",
    Components.stack.filename
  )

  /*:: import * as ProtocolCommon from "../../../modules/addons/ProtocolCommon.jsm";*/
  ChromeUtils.defineModuleGetter(this, "ProtocolCommon", PROTOCOL_COMMON)

  const REQUESTOR_INBOX = `libdweb:protocol:requestor:inbox`
  const REQUESTOR_OUTBOX = `libdweb:protocol:requestor:outbox`
  const RESPONDER_INBOX = `libdweb:protocol:responder:inbox`
  const RESPONDER_OUTBOX = `libdweb:protocol:responder:outbox`
  const PROTOCOLS = `libdweb:protocol:protocols`

  // When request message is received from content script `ProtocolService`
  // creates `ChildRequestorPort` instance for it's target and keeps it for the
  // duration of the request in order to be able to forward response & it's body
  // back to requestor.
  class ChildRequestorPort {
    /*::
  +messageManager: Out<AgentInbox>
  */
    constructor(messageManager /*: Out<AgentInbox>*/) {
      this.messageManager = messageManager
    }
    send(message /*: AgentInboxMessage*/) {
      this.messageManager.sendAsyncMessage(REQUESTOR_INBOX, message)
    }
  }

  // When request is initiated in the parent process `ProtocolService` creates
  // `RequestChannel` and corresponding `ParentRequestorPort` and keeps later for
  // the duration of the request in order to forward response & it's body.
  // By abstracting requestor port `ProtocolService` is able to use same logic
  // regardless of which process request originated.
  class ParentRequestorPort {
    /*::
  +requestChannel: RequestChannel
  */
    constructor(requestChannel /*: Out<AgentInbox>*/) {
      this.requestChannel = this.requestChannel
    }
    send(message /*: AgentInboxMessage*/) {
      this.requestChannel.receiveResponse(message)
    }
  }

  // When protocol register / unregister message is received by the
  // `ProtocolService` it creates a `ResponderPort` for it's target and stores
  // it into local registry in order to forward requests messages to a
  // corresponding responder.
  // Note: Given that multiple extensions can register protocol handler multiple
  // they will map to multiple responders.
  class ResponderPort {
    /*::
  messageManager: Out<HandlerInbox>;
  */
    constructor(messageManager /*: Out<HandlerInbox>*/) {
      this.messageManager = messageManager
    }
    send(message /*: HandlerInboxMessage*/) {
      this.messageManager.sendAsyncMessage(RESPONDER_INBOX, message)
    }
  }

  // `ProtocolService` orchestrates request / response between registered
  // `ProtocolResponder` in the extension process and `ProtocolRequestor` loaded
  // as content process script.
  //
  // When browser initates requests for the registered protocol,
  // `ProtocolRequestor` (loaded in content process) sends a message(s) to the
  // `ProtocolService` (loaded in parent process) which stores `RequestorPort`
  // for the issuing requestor and forwards messaage(s) to the corresponding
  // `ProtocolResponder` (loaded in extension process).
  // Note: Single requests may entail multiple messages from `ProtocolRequestor`
  // as request can be aborted or it's body may be a an async stream send in
  // multiple chunks.
  //
  // When `ProtocolRequestor` receives request message(s) it will invoke
  // corresponding handler to obtain `Response` and send corresponding message(s)
  // back to the sender - `ProtocolService` in parent process, which handles them
  // by forwarding it back to corresponding `ProtocolRequestor`.
  // Note: Single response may entail multiple messages as it's body may stream
  // it's chunks. Furthermore requestor may pause, resume or cancel it's body.
  //
  // At the moment gecko requires `nsIProtocolHandler` to be registered both in
  // every child process and the parent process. If it is used from the parent
  // process it is handler same as when it is used from child except in that case
  // `ParentRequestorPort` is used instead of `ChildRequestorPort` to handle
  // messages in process.
  //
  // When web extension registers / unregisters a new protocol handler
  // `ProtocolResponder` (loaded in the extension process) sends a message to the
  // `ProtocolService` in the parent process, which handles messages by
  // maintaining a mapping of registered protocols to a corresponding responder
  // ports so that requests could be forwarded to them.
  class ProtocolService {
    /*::
  +protocols: { [string]: ProtocolSpec };
  +responders: { [string]: Port<HandlerInboxMessage> };
  +requestors: { [string]: Port<AgentInboxMessage> };
  +requestorsBroadcast: Port<AgentInboxMessage>;

  +id:number;
  isActive:boolean;
  */
    constructor() {
      this.protocols = {}
      this.responders = {}
      this.requestors = {}

      this.id = 0
      this.isActive = false
    }
    receiveMessage(message /*: AgentOutbox | HandlerOutbox */) {
      switch (message.name) {
        case REQUESTOR_OUTBOX:
          return this.receiveRequestorMessage(message)
        case RESPONDER_OUTBOX:
          return this.receiveResponderMessage(message)
      }
    }
    receiveRequestorMessage({ data, target } /*: AgentOutbox*/) {
      const { responders, requestors } = this
      const { scheme, id } = data
      const responder = responders[scheme]
      if (responder) {
        // There will be no requestor if this is a new request.
        if (requestors[id] == null) {
          requestors[id] = new ChildRequestorPort(target)
        }

        responder.send(data)
      }
    }
    receiveResponderMessage({ data, target } /*: HandlerOutbox*/) {
      switch (data.type) {
        case "register":
          return this.register(data, new ResponderPort(target.messageManager))
        case "unregister":
          return this.unregister(data)
        default:
          return this.forwardResponse(data)
      }
    }
    forwardResponse(response /*: ResponseMessage*/) {
      const { requestors } = this
      const { id } = response
      const requestor = requestors[id]
      switch (response.type) {
        case "close-response-stream":
        case "error-response-stream": {
          delete requestor[id]
        }
      }

      requestor.send(response)
    }
    register(
      { scheme, id } /*: RegisterProtocol*/,
      responder /*: Port<HandlerInboxMessage> */
    ) {
      this.activate()

      const { protocols, responders } = this
      if (responders[scheme]) {
        responders[scheme] = responder
      } else {
        const uuid = uuidGen.generateUUID().toString()
        const register = { type: "register", scheme, uuid, id }
        protocols[scheme] = register
        responders[scheme] = responder
        ProtocolCommon.registerProtocol(register, this)
        Services.ppmm.broadcastAsyncMessage(REQUESTOR_INBOX, register)
      }
    }
    unregister({ scheme, id }) {
      const { protocols, responders } = this
      const protocol = protocols[scheme]
      if (protocol != null) {
        delete protocols[scheme]
        delete responders[scheme]

        ProtocolCommon.unregisterProtocol(scheme)
        Services.ppmm.broadcastAsyncMessage(REQUESTOR_INBOX, {
          type: "unregister",
          scheme,
          id,
          uuid: protocol.uuid
        })
      }
    }
    // Used by ProtocolHandler (from ProtocolCommon.jsm) to create an nsIChannel
    newChannel(
      url /*: nsIURI */,
      loadInfo /*: nsILoadInfo */
    ) /*: RequestChannel */ {
      const id = `${url.scheme}:${++this.id}:ProtocolService`
      const channel = ProtocolCommon.newChannel(this, url, loadInfo, id)
      const requestor = new ParentRequestorPort(channel)
      this.requestors[id] = requestor
      return channel
    }
    // Used by Channel (from ProtocolCommon.jsm) to send request messages to
    // the corresponding requestor. Only happens for rare requests in the parent
    // process.
    send(message /*: RequestMessage*/) {
      const { requestors } = this
      const { scheme } = message
      const requestor = requestors[scheme]
      if (requestor) {
        requestor.send(message)
      }
    }
    activate() {
      if (!this.isActive) {
        this.isActive = true
        Services.ppmm.initialProcessData[PROTOCOLS] = this.protocols
        Services.mm.addMessageListener(RESPONDER_OUTBOX, this)
        Services.ppmm.addMessageListener(REQUESTOR_OUTBOX, this)
        Services.ppmm.loadProcessScript(PROTOCOL_CONTENT, true)
      }
    }
    terminate() {
      const { protocols, responders } = this

      Services.ppmm.removeDelayedProcessScript(PROTOCOL_CONTENT)
      Services.ppmm.broadcastAsyncMessage(REQUESTOR_INBOX, {
        type: "terminate"
      })
      Services.mm.removeMessageListener(RESPONDER_OUTBOX, this)
      Services.ppmm.removeMessageListener(REQUESTOR_INBOX, this)

      for (const scheme of Object.keys(protocols)) {
        ProtocolCommon.unregisterProtocol(scheme)
        delete protocols[scheme]
        delete responders[scheme]
      }

      this.requestors = {}

      this.isActive = false
    }
  }

  // @FlowIgnore Flow does not know what `this` is here.
  this.protocol = class extends ExtensionAPI /*:: <Service>*/ {
    /*::
  service:ProtocolService
  */
    onShutdown(reason) {
      if (reason !== "APP_SHUTDOWN") {
        for (const spec of this.registeredProtocols.values()) {
          this.unregister(spec)
        }
      }
    }
    get registeredProtocols() {
      const value = new Map()
      Object.defineProperty(this, "registeredProtocols", { value })
      return value
    }
    get service() /*: ProtocolService*/ {
      const service = new ProtocolService()
      Object.defineProperty(Object.getPrototypeOf(this), "service", {
        value: service
      })
      return service
    }
    register(spec, responder) {
      // ProtocolUtil.ensurePermission(this.extension, spec.scheme);
      this.registeredProtocols.set(spec.scheme, spec)
      this.service.register(spec, responder)
    }
    unregister(spec) {
      if (this.registeredProtocols.has(spec.scheme)) {
        this.registeredProtocols.delete(spec.scheme)
        this.service.unregister(spec)
      }
    }
    getAPI(context) {
      return {
        protocol: {
          register: spec =>
            this.register(
              spec,
              new ResponderPort(context.parentMessageManager)
            ),
          unregister: spec => this.unregister(spec)
        }
      }
    }
  }
} catch (e) {
  console.error(e)
}

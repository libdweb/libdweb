/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow strict
/* eslint spaced-comment: ["error", "always", { "markers": [":", "::"], "exceptions":[":"] }] */
"use strict";

/*::
import { Components, ChromeUtils } from "gecko";
import type { nsresult, nsWebProgressState, nsIIDRef, nsIFactory, nsIStreamListener, nsIInterfaceRequestor, nsILoadGroup, nsLoadFlags, nsILoadInfo,  nsIURI, nsIProtocolHandler, nsIRequest, nsIChannel, nsIUploadChannel2, nsISupports, nsITransportSecurityInfo, nsIChannelEventSink, nsIMessageListener, nsIMessageSender, nsIMessageBroadcaster, nsIMessageListenerManager, nsIProgressEventSink, nsIInputStream, nsIBinaryInputStream, nsIInputStreamPump, nsIWritablePropertyBag2 } from "gecko"
import type { Out, Inn, AgentOutbox, RequestMessage, ReadyState, ProtocolSpec, HandlerInbox, AgentInbox, HandlerOutbox, ResponseMessage, RequestHandler, AgentInboxMessage, AgentOutboxMessage, Register, Unregister, RegisterProtocol, UnregisterProtocol, Port, RequestChannel } from "../../components/extensions/interface/protocol.js"
*/
const EXPORTED_SYMBOLS = ["ProtocolCommon"];
const { manager: Cm } = Components;

const contentSecManager = Cc[
  "@mozilla.org/contentsecuritymanager;1"
].getService(Ci.nsIContentSecurityManager);

const { ID } = Components;

const componentRegistrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);
const getFactoryByCID = cid => Cm.getClassObject(cid, Ci.nsIFactory);

const getCIDByContractID = contractID =>
  componentRegistrar.isContractIDRegistered(contractID)
    ? componentRegistrar.contractIDToCID(contractID)
    : null;

const getContractIDByScheme = scheme =>
  `@mozilla.org/network/protocol;1?name=${scheme}`;

const getCIDByScheme = scheme =>
  getCIDByContractID(getContractIDByScheme(scheme)) || null;

const unregisterProtocol = (scheme /*: string */) => {
  const cid = getCIDByScheme(scheme);
  const factory = cid && getFactoryByCID(cid);
  if (cid && factory) {
    componentRegistrar.unregisterFactory(cid, factory);
  }
};

const isContractIDRegistered = contractID =>
  componentRegistrar.isContractIDRegistered(contractID);

const IDLE = 0;
const ACTIVE = 1;
const PAUSED = 2;
const CANCELED = 3;
const CLOSED = 4;
const FAILED = 5;

class TransportSecurityInfo /*:: implements nsITransportSecurityInfo */ {
  /*::
  securityState:nsWebProgressState
  shortSecurityDescription:string
  errorCode:nsresult
  errorMessage:string
  SSLStatus:*
  state:string
  */
  constructor() {
    this.state = "secure";
    this.securityState = Ci.nsIWebProgressListener.STATE_IS_SECURE;
    this.errorCode = Cr.NS_OK;
    this.shortSecurityDescription = "Content Addressed";
    this.SSLStatus = {
      cipherSuite: "TLS_ECDH_ECDSA_WITH_AES_128_GCM_SHA256",
      // TLS_VERSION_1_2
      protocolVersion: 3,
      isDomainMismatch: false,
      isNotValidAtThisTime: true,
      serverCert: {
        subjectName: "Content Addressing",
        displayName: "Content Addressing",
        certType: Ci.nsIX509Cert.CA_CERT,
        isSelfSigned: true,
        validity: {},
      },
    };
  }
  QueryInterface(iid) {
    const isSupported =
      false ||
      iid.equals(Ci.nsISupports) ||
      iid.equals(Ci.nsITransportSecurityInfo) ||
      iid.equals(Ci.nsISSLStatusProvider);
    if (isSupported) {
      return this;
    }

    throw Cr.NS_ERROR_NO_INTERFACE;
  }
}

const UNKNOWN_CONTENT_TYPE = "application/x-unknown-content-type";

const streamFromBuffer = (buffer /*: ArrayBuffer */) => {
  const stream = Cc[
    "@mozilla.org/io/arraybuffer-input-stream;1"
  ].createInstance(Ci.nsIArrayBufferInputStream);

  const { byteLength } = buffer;
  stream.setData(buffer, 0, byteLength);
  return stream;
};

class RequestBody {
  /*::
  port:Port<RequestMessage>;
  scheme:string;
  id:string;
  inputStream:nsIInputStream;
  binaryInputStream:nsIBinaryInputStream;
  inputStreamPump:nsIInputStreamPump;
  includesHeaders:boolean;
  contentLength:number;
  readyState:ReadyState
  */
  static new(
    port /*: Port<RequestMessage> */,
    id /*: string */,
    scheme /*: string */,
    includesHeaders /*: boolean */,
    contentLength /*: number */,
    inputStream /*: nsIInputStream */
  ) {
    const binaryInputStream = Cc[
      "@mozilla.org/binaryinputstream;1"
    ].createInstance(Ci.nsIBinaryInputStream);
    binaryInputStream.setInputStream(inputStream);
    const inputStreamPump = Cc[
      "@mozilla.org/network/input-stream-pump;1"
    ].createInstance(Ci.nsIInputStreamPump);
    inputStreamPump.init(inputStream, 0, 0, true, null);

    return new RequestBody(
      port,
      id,
      scheme,
      includesHeaders,
      contentLength,
      inputStream,
      binaryInputStream,
      inputStreamPump
    );
  }
  constructor(
    port /*: Port<RequestMessage> */,
    id /*: string */,
    scheme /*: string */,
    includesHeaders /*: boolean */,
    contentLength /*: number */,
    inputStream /*: nsIInputStream */,
    binaryInputStream /*: nsIBinaryInputStream */,
    inputStreamPump /*: nsIInputStreamPump */
  ) {
    this.port = port;
    this.scheme = scheme;
    this.id = id;
    this.includesHeaders = includesHeaders;
    this.contentLength = contentLength;
    this.inputStream = inputStream;
    this.binaryInputStream = binaryInputStream;
    this.inputStreamPump = inputStreamPump;
    this.readyState = IDLE;
  }
  onStartRequest(request, context) {}
  onDataAvailable(
    request /*: nsIRequest*/,
    inputStream /*: nsIInputStream*/,
    offset /*: number*/,
    size /*: number*/
  ) {
    const buffer = new ArrayBuffer(size);
    this.binaryInputStream.readArrayBuffer(size, buffer);
    this.enqueue(buffer);
  }
  onStopRequest(request, status) {
    switch (status) {
      case Cr.NS_OK:
        return this.close();
      case Cr.NS_BINDING_ABORTED:
        return undefined;
      default:
        return this.error(status);
    }
  }

  activate() {
    switch (this.readyState) {
      case IDLE: {
        this.readyState = ACTIVE;
        return this.inputStreamPump.asyncRead(this, null);
      }
    }
  }

  // Methods correspond to

  enqueue(buffer) {
    const { id, scheme } = this;
    this.port.send({
      type: "write-request-stream",
      id,
      scheme,
      buffer,
    });
  }
  close() {
    const { id, scheme } = this;
    this.port.send({
      type: "close-request-stream",
      id,
      scheme,
    });
    this.inputStream.close();
    this.binaryInputStream.close();
    this.dispose();
  }
  error(status) {
    const { id, scheme } = this;
    this.port.send({
      type: "error-request-stream",
      id,
      scheme,
      message: String(status),
    });
    this.inputStreamPump.cancel(status);
    this.inputStream.close();
    this.binaryInputStream.close();
    this.dispose();
  }

  // Following methads are invoked in effect to `request.body` consumption.
  // `resume` is invoked in effect to `underlyingSource.pull(controller)`
  // `suspend` is invoked when `controller.desiredSize <= 0`
  // `cancel` is inovked in effect to `underlyingSource.cancel`
  suspend() {
    switch (this.readyState) {
      case ACTIVE: {
        this.readyState = PAUSED;
        return this.inputStreamPump.suspend();
      }
    }
  }
  resume() {
    switch (this.readyState) {
      case IDLE: {
        return this.activate();
      }
      case PAUSED: {
        this.readyState = ACTIVE;
        return this.inputStreamPump.resume();
      }
    }
  }
  cancel(status /*: nsresult */ = Cr.NS_BINDING_ABORTED) {
    if (this.port) {
      this.inputStreamPump.cancel(status);
      this.inputStream.close();
      this.binaryInputStream.close();
    }
    this.dispose();
  }

  dispose() {
    delete this.port;
    delete this.inputStreamPump;
    delete this.inputStream;
    delete this.binaryInputStream;
  }
}

class Channel /*:: implements nsIChannel, nsIUploadChannel2, nsIRequest, nsIWritablePropertyBag2 */ {
  /*::
  port: Port<RequestMessage>
  URI: nsIURI
  scheme: string
  url: string
  originalURI: nsIURI
  loadInfo: null | nsILoadInfo
  contentCharset: ?string
  contentLength: number
  mimeType: ?string
  byteOffset: number
  id: string
  owner: nsISupports<*> | null
  securityInfo: nsITransportSecurityInfo | null
  loadFlags: nsLoadFlags
  loadGroup: nsILoadGroup
  name: string
  status: nsresult
  readyState: ReadyState
  contentDisposition: number
  contentDispositionFilename: string
  contentDispositionHeader: string
  notificationCallbacks: nsIInterfaceRequestor<nsIProgressEventSink> | null;

  listener: ?nsIStreamListener
  context: ?nsISupports<mixed>
  properties: {[string]:any};
  body:?RequestBody
  method:string
  */
  constructor(
    port /*: Port<RequestMessage> */,
    uri /*: nsIURI */,
    loadInfo /*: null | nsILoadInfo */,
    id /*: string */
  ) {
    this.port = port;
    this.URI = uri;
    this.url = uri.spec;
    this.scheme = uri.scheme;
    this.originalURI = uri;
    this.loadInfo = loadInfo;
    this.originalURI = uri;
    this.contentCharset = "utf-8";
    this.contentLength = -1;
    this.mimeType = null;
    this.contentDispositionFilename = "";
    this.contentDispositionHeader = "";
    this.byteOffset = 0;
    this.id = id;

    this.owner = null;
    this.securityInfo = new TransportSecurityInfo();
    this.notificationCallbacks = null;
    this.loadFlags = Ci.nsIRequest.LOAD_NORMAL;
    this.name = uri.spec;
    this.status = Cr.NS_ERROR_NOT_INITIALIZED;
    this.readyState = IDLE;

    this.properties = {};
    this.method = "GET";
    this.body = null;
  }
  QueryInterface(iid) {
    const isSupported =
      iid.equals(Ci.nsISupports) ||
      iid.equals(Ci.nsIChannel) ||
      iid.equals(Ci.nsIRequest) ||
      iid.equals(Ci.nsIPropertyBag2) ||
      iid.equals(Ci.nsIPropertyBag) ||
      iid.equals(Ci.nsIWritablePropertyBag2) ||
      iid.equals(Ci.nsIUploadChannel2);
    if (isSupported) {
      return this;
    }
    throw Cr.NS_ERROR_NO_INTERFACE;
  }

  // nsIUploadChannel2
  explicitSetUploadStream(
    stream,
    contentType,
    contentLength,
    method,
    streamHasHeaders
  ) {
    this.setPropertyAsAString("content-type", contentType);
    this.setPropertyAsAString("content-length", contentLength);
    this.contentType = contentType;
    this.method = method;

    // If content length is `0` e.g `fetch(url, {method:"PUT", body:""})` no
    // point in doing all the IPC back and forth so we just treat as no body.
    if (contentLength !== 0) {
      this.body = RequestBody.new(
        this.port,
        this.id,
        this.scheme,
        streamHasHeaders,
        contentLength,
        stream
      );
    }
  }

  get contentType() {
    const { mimeType } = this;
    if (mimeType != null) {
      return mimeType;
    }

    return UNKNOWN_CONTENT_TYPE;
  }
  set contentType(_) {}
  toJSON() {
    return {
      scheme: this.URI.scheme,
      url: this.URI.spec,
      readyState: this.readyState,
      status: this.status,
      contentType: this.contentType,
      byteOffset: this.byteOffset,
      contentLength: this.contentLength,
    };
  }
  open() {
    throw Cr.NS_BASE_STREAM_WOULD_BLOCK;
  }
  asyncOpen(
    listener /*: nsIStreamListener */,
    context /*: ?nsISupports<mixed> */
  ) {
    // TODO: Make sure that we report status updates
    // https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/Interface/nsIProgressEventSink
    const outListener = contentSecManager.performSecurityCheck(this, listener);
    switch (this.readyState) {
      case IDLE: {
        this.listener = outListener;
        this.context = context;
        this.status = Cr.NS_OK;
        this.loadGroup && this.loadGroup.addRequest(this, context);
        return this.start();
      }
      default: {
        throw this.status;
      }
    }
  }

  // nsIRequest

  start() {
    const { url, scheme, id, method, properties, body } = this;
    this.port.send({
      type: "start-request",
      id,
      scheme,

      url,
      contentLength: body == null ? 0 : body.contentLength,
      method,

      headers: properties,
    });
  }

  isPending() {
    switch (this.readyState) {
      case ACTIVE:
      case PAUSED: {
        return true;
      }
      default: {
        return false;
      }
    }
  }

  cancel(status /*: nsresult */ = Cr.NS_BINDING_ABORTED) {
    const { readyState, port } = this;
    switch (readyState) {
      case ACTIVE:
      case PAUSED: {
        this.setStatus(status);
        return port.send({
          type: "cancel-request",
          id: this.id,
          scheme: this.scheme,
        });
      }
      default: {
        throw this.status;
      }
    }
  }
  suspend() {
    switch (this.readyState) {
      case ACTIVE: {
        this.readyState = PAUSED;
        return this.port.send({
          type: "suspend-request",
          id: this.id,
          scheme: this.scheme,
        });
      }
      case PAUSED: {
        return void this;
      }
      default: {
        throw this.status;
      }
    }
  }
  resume() {
    switch (this.readyState) {
      case ACTIVE: {
        return void this;
      }
      case PAUSED: {
        this.readyState = ACTIVE;
        return this.port.send({
          type: "resume-request",
          id: this.id,
          scheme: this.scheme,
        });
      }
      default: {
        throw this.status;
      }
    }
  }

  setStatus(status /*: nsresult */) {
    switch (status) {
      case Cr.NS_OK:
      case Cr.NS_BINDING_ABORTED: {
        this.readyState = CANCELED;
        this.status = Cr.NS_BINDING_ABORTED;
        return this;
      }
      default: {
        this.readyState = FAILED;
        this.status = status;
        return this;
      }
    }
  }

  // ResponseReceiver

  receiveResponse(message /*: ResponseMessage */) {
    switch (message.type) {
      case "start-response": {
        return this.onStartResponse(message);
      }
      case "write-response-stream": {
        return this.onWriteResponseStream(message);
      }
      case "close-response-stream": {
        return this.onCloseResponseStream(message);
      }
      case "error-response-stream": {
        return this.onErrorResponseStream(message);
      }
      case "suspend-request-stream": {
        return this.onSuspendRequestStream(message);
      }
      case "resume-request-stream": {
        return this.onResumeRequestStream(message);
      }
      case "cancel-request-stream": {
        return this.onCancelRequestStream(message);
      }
    }
  }
  onStartResponse({ ok, status, statusText, headers }) {
    const contentType = headers["content-type"] || "";
    const contentLength = headers["content-length"] || "";
    const [mimeType] = contentType.split(";");
    const [, contentCharset] = /charset=([^;]+)/.exec(contentType) || [];

    if (mimeType != "") {
      this.mimeType = mimeType;
    }

    if (contentLength != null && contentCharset !== "") {
      this.contentLength = parseInt(contentLength, 10);
    }

    if (contentCharset != "") {
      this.contentCharset = contentCharset;
    }

    this.status = Cr.NS_OK;
    this.readyState = ACTIVE;
    this.byteOffset = 0;

    // If contentType is known start request, otherwise defer until it
    // can be inferred on first data chunk.
    if (this.mimeType != null) {
      this.listener.onStartRequest(this);
    }
  }
  onWriteResponseStream({ buffer }) {
    const stream = streamFromBuffer(buffer);
    const { listener } = this;

    // TODO: Resurect `nsIContentSniffer` that used to be used to detect
    // contentType before it got removed by Bug 1488306.
    const byteLength = stream.available();

    listener.onDataAvailable(this, stream, 0, byteLength);
    this.byteOffset += byteLength;
  }
  onCloseResponseStream(message) {
    this.stop();
  }
  onErrorResponseStream(message) {
    this.setStatus(Cr.NS_ERROR_XPC_JAVASCRIPT_ERROR_WITH_DETAILS);
    this.stop();
  }

  onSuspendRequestStream(message) {
    const { body } = this;
    if (body) {
      body.suspend();
    }
  }
  onResumeRequestStream(message) {
    const { body } = this;
    if (body) {
      body.resume();
    }
  }
  onCancelRequestStream(message) {
    const { body } = this;
    if (body) {
      body.cancel();
    }
  }

  stop() {
    this.readyState = CLOSED;
    this.contentLength = this.byteOffset;
    const { listener, context, status } = this;
    try {
      if (this.body) {
        this.body.cancel();
      }
      if (status != Cr.NS_BINDING_ABORTED) {
        listener.onStopRequest(this, status);
        this.loadGroup && this.loadGroup.removeRequest(this, context, status);
      }
    } finally {
      this.dispose();
    }
  }

  dispose() {
    delete this.context;
    delete this.listener;
    delete this.port;
  }

  // nsIWritablePropertyBag2

  setPropertyAsInt32(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsUint32(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsInt64(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsUint64(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsDouble(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsAString(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsACString(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsAUTF8String(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsBool(name, value) {
    this.setPropertyAsInterface(name, value);
  }
  setPropertyAsInterface(name, value /*: mixed */) {
    this.properties[name] = value;
  }

  get enumerator() {
    const keys = Object.keys(this.properties)
    let i = 0
    return {
      getNext() {
        return keys[i++]
      },
      hasMoreElements() {
        return i < keys.length
      }
    }
  }
  getPropertyAsInt32(name) {
    return this.get(name);
  }
  getPropertyAsUint32(name) {
    return this.get(name);
  }
  getPropertyAsInt64(name) {
    return this.get(name);
  }
  getPropertyAsUint64(name) {
    return this.get(name);
  }
  getPropertyAsDouble(name) {
    return this.get(name);
  }
  getPropertyAsAString(name) {
    return this.get(name);
  }
  getPropertyAsACString(name) {
    return this.get(name);
  }
  getPropertyAsAUTF8String(name) {
    return this.get(name);
  }
  getPropertyAsBool(name) {
    return this.get(name);
  }

  getProperty(name) {
    return this.get(name);
  }
  getPropertyAsInterface(name) {
    return this.get(name);
  }

  get(name) /*: any */ {
    return this.properties[name];
  }

  hasKey(name) {
    return name in this.properties;
  }
}

class ProtocolHandler /*:: implements nsIProtocolHandler */ {
  /*::
  scheme: string
  defaultPort: number
  handler: RequestHandler
  protocolFlags: number
  */
  constructor(scheme, handler) {
    this.scheme = scheme;
    this.defaultPort = -1;
    this.handler = handler;
    this.protocolFlags =
      Ci.nsIProtocolHandler.URI_STD |
      Ci.nsIProtocolHandler.URI_IS_POTENTIALLY_TRUSTWORTHY |
      Ci.nsIProtocolHandler.URI_LOADABLE_BY_EXTENSIONS;
  }
  toJSON() {
    return {
      scheme: this.scheme,
      defaultPort: this.defaultPort,
      protocolFlags: this.protocolFlags,
    };
  }
  allowPort(port, scheme) {
    return false;
  }
  newURI(spec, charset, baseURI) {
    return Cc["@mozilla.org/network/standard-url-mutator;1"]
      .createInstance(Ci.nsIStandardURLMutator)
      .init(
        Ci.nsIStandardURL.URLTYPE_AUTHORITY,
        this.defaultPort,
        spec,
        charset,
        baseURI
      )
      .finalize();
  }
  newChannel(uri /*: nsIURI */, loadInfo /*: nsILoadInfo */) {
    return this.handler.newChannel(uri, loadInfo);
  }
  QueryInterface(iid) {
    if (iid.equals(Ci.nsIProtocolHandler) || iid.equals(Ci.nsISupports)) {
      return this;
    }
    throw Cr.NS_ERROR_NO_INTERFACE;
  }
}

class Factory /*:: implements nsIFactory<nsIProtocolHandler> */ {
  /*::
  instance: nsIProtocolHandler
  */
  constructor(instance /*: nsIProtocolHandler */) {
    this.instance = instance;
  }
  createInstance(
    outer /*: null | nsISupports<nsIProtocolHandler> */,
    iid /*: nsIIDRef<nsIProtocolHandler> */
  ) /*: nsIProtocolHandler */ {
    if (outer != null) {
      throw Cr.NS_ERROR_NO_AGGREGATION;
    }

    return this.instance;
  }
  lockFactory(lock /*: boolean */) /*: void */ {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  }
  QueryInterface(
    iid /*: nsIIDRef<nsIFactory<nsIProtocolHandler>> */
  ) /*: nsIFactory<nsIProtocolHandler> */ {
    if (iid.equals(Ci.nsISupports) || iid.equals(Ci.nsIFactory)) {
      return this;
    }

    throw Cr.NS_ERROR_NO_INTERFACE;
  }
}

const newChannel = (
  port /*: Port<RequestMessage> */,
  uri /*: nsIURI */,
  loadInfo /*: null | nsILoadInfo */,
  id /*: string */
) /*: RequestChannel */ => new Channel(port, uri, loadInfo, id);

const registerProtocol = (
  { scheme, uuid } /*: ProtocolSpec */,
  handler /*: RequestHandler */
) => {
  const contractID = getContractIDByScheme(scheme);
  if (isContractIDRegistered(contractID)) {
    unregisterProtocol(scheme);
  }

  const cid = new ID(uuid);
  const description = `${scheme} protocol handler`;
  const factory = new Factory(new ProtocolHandler(scheme, handler));
  componentRegistrar.registerFactory(cid, description, contractID, factory);
};

const ProtocolCommon = { registerProtocol, unregisterProtocol, newChannel };
/*::
export {registerProtocol, unregisterProtocol, newChannel}
*/

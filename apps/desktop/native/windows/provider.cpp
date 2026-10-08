// 127Vaults Windows COM passkey provider. Vault keys stay in the Rust agent.
#define NOMINMAX
#include <windows.h>
#include <appmodel.h>
#include <bcrypt.h>
#include <ncrypt.h>
#include <commctrl.h>
#include <shellapi.h>
#include <webauthn.h>
#include "include/webauthnplugin.h"
#include "include/pluginauthenticator.h"
#include "include/json.hpp"
#include <atomic>
#include <iostream>
#include <fstream>
#include <mutex>
#include <vector>
#include <filesystem>
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "ncrypt.lib")
#pragma comment(lib, "comctl32.lib")
#pragma comment(linker,"/manifestdependency:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\"")
using Json=nlohmann::json;
const CLSID PROVIDER={0x90e787ad,0xe763,0x4b10,{0x98,0xef,0xb9,0x02,0x80,0xa1,0x27,0x01}};
const wchar_t* CLSID_TEXT=L"{90E787AD-E763-4B10-98EF-B90280A12701}";
HMODULE webauthn=nullptr;
template<class T> T api(const char* name) {auto p=reinterpret_cast<T>(GetProcAddress(webauthn,name));if(!p) throw HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED);return p;}
#define API(name) api<decltype(&name)>(#name)
void check(HRESULT hr){if(FAILED(hr))throw hr;}
std::wstring wide(const std::string& input){if(input.empty())return {};int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,input.data(),static_cast<int>(input.size()),nullptr,0);if(!n)throw E_INVALIDARG;std::wstring out(n,L'\0');MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,input.data(),static_cast<int>(input.size()),out.data(),n);return out;}
std::string hex(const BYTE* p,size_t n){if(n>65536 || (n&&!p))throw E_INVALIDARG;const char* chars="0123456789abcdef";std::string out;out.reserve(n*2);for(size_t i=0;i<n;i++){out+=chars[p[i]>>4];out+=chars[p[i]&15];}return out;}
std::vector<BYTE> unhex(const std::string& s){if(s.size()>131072 || s.size()%2)throw E_INVALIDARG;std::vector<BYTE> out;auto digit=[](char c)->int{if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw E_INVALIDARG;};for(size_t i=0;i<s.size();i+=2)out.push_back(static_cast<BYTE>(digit(s[i])*16+digit(s[i+1])));return out;}
std::vector<BYTE> base64url(const std::string& s){std::vector<BYTE> out;unsigned bits=0,value=0;for(char c:s){int n=c>='A'&&c<='Z'?c-'A':c>='a'&&c<='z'?c-'a'+26:c>='0'&&c<='9'?c-'0'+52:c=='-'?62:c=='_'?63:-1;if(n<0)throw E_INVALIDARG;value=(value<<6)|n;bits+=6;if(bits>=8){bits-=8;out.push_back(static_cast<BYTE>(value>>bits));}}return out;}
std::wstring executable(){std::wstring path(32768,L'\0');DWORD n=GetModuleFileNameW(nullptr,path.data(),static_cast<DWORD>(path.size()));if(!n||n==path.size())throw E_FAIL;path.resize(n);return path;}
std::wstring guid(const GUID& id){wchar_t s[40];StringFromGUID2(id,s,40);return s;}
std::string guid_string(const GUID& id){auto s=guid(id);std::string result; for(size_t i=1;i+1<s.size();i++)result.push_back(static_cast<char>(s[i]));return result;}
void verify(const std::vector<BYTE>& data,const std::vector<BYTE>& signature,bool uv){
  DWORD length=0;BYTE* raw=nullptr;
  check(uv?API(WebAuthNPluginGetUserVerificationPublicKey)(PROVIDER,&length,&raw):API(WebAuthNPluginGetOperationSigningPublicKey)(PROVIDER,&length,&raw));
  if(!raw || length<sizeof(BCRYPT_KEY_BLOB) || length>65536){API(WebAuthNPluginFreePublicKeyResponse)(raw);throw E_INVALIDARG;}
  std::vector<BYTE> key(raw,raw+length);API(WebAuthNPluginFreePublicKeyResponse)(raw);
  if(key.size()<sizeof(BCRYPT_KEY_BLOB)||signature.empty())throw E_INVALIDARG;
  NCRYPT_PROV_HANDLE provider=0;NCRYPT_KEY_HANDLE handle=0;
  check(NCryptOpenStorageProvider(&provider,nullptr,0));
  auto hr=NCryptImportKey(provider,0,BCRYPT_PUBLIC_KEY_BLOB,nullptr,&handle,key.data(),static_cast<DWORD>(key.size()),0);
  if(FAILED(hr)){NCryptFreeObject(provider);throw hr;}
  BYTE hash[32];auto status=BCryptHash(BCRYPT_SHA256_ALG_HANDLE,nullptr,0,const_cast<BYTE*>(data.data()),static_cast<ULONG>(data.size()),hash,32);
  if(status<0){NCryptFreeObject(handle);NCryptFreeObject(provider);throw E_FAIL;}
  BCRYPT_PSS_PADDING_INFO padding{BCRYPT_SHA256_ALGORITHM,32};
  bool rsa=reinterpret_cast<const BCRYPT_KEY_BLOB*>(key.data())->Magic==BCRYPT_RSAPUBLIC_MAGIC;
  hr=NCryptVerifySignature(handle,rsa?&padding:nullptr,hash,32,const_cast<BYTE*>(signature.data()),static_cast<DWORD>(signature.size()),rsa?NCRYPT_PAD_PSS_FLAG:0);
  NCryptFreeObject(handle);NCryptFreeObject(provider);check(hr);
}
Json call_vault(const Json& message){
  auto host=std::filesystem::path(executable()).parent_path()/L"127vaults-native-passkey-host.exe";
  if(!std::filesystem::exists(host))throw HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
  SECURITY_ATTRIBUTES sa{sizeof(sa),nullptr,TRUE};HANDLE inR=nullptr,inW=nullptr,outR=nullptr,outW=nullptr;
  if(!CreatePipe(&inR,&inW,&sa,0))throw E_FAIL;
  if(!CreatePipe(&outR,&outW,&sa,0)){CloseHandle(inR);CloseHandle(inW);throw E_FAIL;}
  SetHandleInformation(inW,HANDLE_FLAG_INHERIT,0);SetHandleInformation(outR,HANDLE_FLAG_INHERIT,0);
  STARTUPINFOW start{sizeof(start)};start.dwFlags=STARTF_USESTDHANDLES;start.hStdInput=inR;start.hStdOutput=outW;start.hStdError=outW;
  PROCESS_INFORMATION process{};std::wstring cmd=L"\""+host.wstring()+L"\"";
  BOOL created=CreateProcessW(host.c_str(),cmd.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,nullptr,&start,&process);
  CloseHandle(inR);CloseHandle(outW);
  if(!created){CloseHandle(inW);CloseHandle(outR);throw E_FAIL;}
  auto input=message.dump();DWORD wrote=0;BOOL sent=WriteFile(inW,input.data(),static_cast<DWORD>(input.size()),&wrote,nullptr);CloseHandle(inW);
  if(!sent||wrote!=input.size()){TerminateProcess(process.hProcess,2);CloseHandle(process.hProcess);CloseHandle(process.hThread);CloseHandle(outR);throw E_FAIL;}
  std::string output;char buffer[4096];DWORD read=0;
  while(ReadFile(outR,buffer,sizeof(buffer),&read,nullptr)&&read){output.append(buffer,read);if(output.size()>262144){TerminateProcess(process.hProcess,2);break;}}
  CloseHandle(outR);WaitForSingleObject(process.hProcess,120000);DWORD code=2;GetExitCodeProcess(process.hProcess,&code);CloseHandle(process.hProcess);CloseHandle(process.hThread);
  if(code!=0)throw HRESULT_FROM_WIN32(ERROR_LOCKED);
  return Json::parse(output);
}
int choose(HWND parent,const std::wstring& title,const std::wstring& text,const std::vector<std::wstring>& choices){
  if(choices.empty()||choices.size()>64)throw HRESULT_FROM_WIN32(ERROR_NOT_FOUND);
  std::vector<TASKDIALOG_BUTTON> buttons;for(size_t i=0;i<choices.size();i++)buttons.push_back({100+static_cast<int>(i),choices[i].c_str()});
  TASKDIALOGCONFIG config{sizeof(config)};config.hwndParent=parent;config.dwFlags=TDF_ALLOW_DIALOG_CANCELLATION|TDF_USE_COMMAND_LINKS;config.pszWindowTitle=L"127Vaults";config.pszMainInstruction=title.c_str();config.pszContent=text.c_str();config.dwCommonButtons=TDCBF_CANCEL_BUTTON;config.cButtons=static_cast<UINT>(buttons.size());config.pButtons=buttons.data();int selected=0;check(TaskDialogIndirect(&config,&selected,nullptr,nullptr));if(selected<100)throw static_cast<HRESULT>(NTE_USER_CANCELLED);return selected-100;
}
void cache_credential(const Json& meta){
  auto id=base64url(meta.at("credentialId"));auto user=base64url(meta.at("userHandle"));
  auto rp=wide(meta.at("rpId")),name=wide(meta.at("username")),display=wide(meta.at("displayName"));
  WEBAUTHN_RP_ENTITY_INFORMATION rpInfo{WEBAUTHN_RP_ENTITY_INFORMATION_CURRENT_VERSION,rp.c_str(),rp.c_str(),nullptr};
  WEBAUTHN_USER_ENTITY_INFORMATION userInfo{WEBAUTHN_USER_ENTITY_INFORMATION_CURRENT_VERSION,static_cast<DWORD>(user.size()),user.data(),name.c_str(),nullptr,display.c_str()};
  WEBAUTHN_PLUGIN_CREDENTIAL_DETAILS detail{};
  detail.cbCredentialId=static_cast<DWORD>(id.size());detail.pbCredentialId=id.data();detail.pwszRpId=rp.c_str();detail.pwszRpName=rp.c_str();detail.cbUserId=static_cast<DWORD>(user.size());detail.pbUserId=user.data();detail.pwszUserName=name.c_str();detail.pwszUserDisplayName=display.c_str();
  check(API(WebAuthNPluginAuthenticatorAddCredentials)(PROVIDER,1,&detail));
}
class Authenticator final:public IPluginAuthenticator, public IDispatch {
  std::atomic<ULONG> refs{1};std::mutex gate,stateMutex;GUID transaction{};std::atomic<bool> cancelled{false};
  HRESULT operation(PCWEBAUTHN_PLUGIN_OPERATION_REQUEST request,PWEBAUTHN_PLUGIN_OPERATION_RESPONSE response,bool create){
    try{
      if(!request||!response||request->requestType!=WEBAUTHN_PLUGIN_REQUEST_TYPE_CTAP2_CBOR)throw E_INVALIDARG;
      *response={};std::unique_lock<std::mutex> lock(gate,std::try_to_lock);if(!lock.owns_lock())throw HRESULT_FROM_WIN32(ERROR_BUSY);
      {std::lock_guard<std::mutex> stateLock(stateMutex);transaction=request->transactionId;cancelled=false;}
      auto raw=unhex(hex(request->pbEncodedRequest,request->cbEncodedRequest));auto signature=unhex(hex(request->pbRequestSignature,request->cbRequestSignature));verify(raw,signature,false);
      Json envelope={{"operation",create?"create":"get"},{"requestHex",hex(raw.data(),raw.size())},{"opSignature",hex(signature.data(),signature.size())},{"transaction",guid_string(transaction)},{"preview",true}};
      Json preview;
      try{preview=call_vault(envelope);}catch(...){MessageBoxW(request->hWnd,L"Open and unlock 127Vaults Desktop, then try again. Your master password is entered only in Desktop.",L"127Vaults is locked",MB_OK|MB_ICONINFORMATION);throw;}
      std::vector<Json> rows;std::vector<std::wstring> labels;
      for(auto& row:preview.at(create?"vaults":"entries")){if(create&&row.value("retired",false))continue;rows.push_back(row);labels.push_back(wide(create?row.value("name","Private"):row.at("metadata").value("displayName",row.value("title","Passkey"))));}
      auto rp=wide(preview.at("rpId"));int selected=choose(request->hWnd,create?L"Save passkey in 127Vaults":L"Use a 127Vaults passkey",rp,labels);
      envelope["vaultId"]=rows.at(selected).at("vaultId");if(!create)envelope["itemId"]=rows.at(selected).at("itemId");
      if(cancelled)throw static_cast<HRESULT>(NTE_USER_CANCELLED);
      WEBAUTHN_PLUGIN_USER_VERIFICATION_REQUEST uv{request->hWnd,transaction,nullptr,L"127Vaults passkey approval"};DWORD uvSize=0;BYTE* uvRaw=nullptr;
      check(API(WebAuthNPluginPerformUserVerification)(&uv,&uvSize,&uvRaw));std::vector<BYTE> uvSignature(uvRaw,uvRaw+uvSize);API(WebAuthNPluginFreeUserVerificationResponse)(uvRaw);
      verify(raw,uvSignature,true);if(cancelled)throw static_cast<HRESULT>(NTE_USER_CANCELLED);
      envelope["uvSignature"]=hex(uvSignature.data(),uvSignature.size());envelope["preview"]=false;
      auto result=call_vault(envelope);if(cancelled)throw static_cast<HRESULT>(NTE_USER_CANCELLED);
      auto bytes=unhex(result.at("responseHex"));
      auto memory=static_cast<BYTE*>(CoTaskMemAlloc(bytes.size()));if(!memory)throw E_OUTOFMEMORY;memcpy(memory,bytes.data(),bytes.size());response->pbEncodedResponse=memory;response->cbEncodedResponse=static_cast<DWORD>(bytes.size());
      if(create){try{cache_credential(result.at("cache").at("metadata"));}catch(...){/* Credential is durable; cache maintenance can retry. */}}
      return S_OK;
    }catch(HRESULT hr){return hr;}catch(...){return E_FAIL;}
  }
public:
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(iid==IID_IUnknown||iid==__uuidof(IPluginAuthenticator))*out=static_cast<IPluginAuthenticator*>(this);else if(iid==IID_IDispatch)*out=static_cast<IDispatch*>(this);else return E_NOINTERFACE;AddRef();return S_OK;}
  HRESULT STDMETHODCALLTYPE GetTypeInfoCount(UINT* count)override{if(!count)return E_POINTER;*count=0;return S_OK;}
  HRESULT STDMETHODCALLTYPE GetTypeInfo(UINT,LCID,ITypeInfo**)override{return E_NOTIMPL;}
  HRESULT STDMETHODCALLTYPE GetIDsOfNames(REFIID,LPOLESTR* names,UINT count,LCID,DISPID* ids)override{if(count!=1||!names||!ids||wcscmp(names[0],L"Verify"))return DISP_E_UNKNOWNNAME;*ids=1;return S_OK;}
  HRESULT STDMETHODCALLTYPE Invoke(DISPID id,REFIID,LCID,WORD,DISPPARAMS* args,VARIANT* result,EXCEPINFO*,UINT*)override{
    try{if(id!=1||!args||args->cArgs!=1||args->rgvarg[0].vt!=VT_BSTR)return DISP_E_BADPARAMCOUNT;
      auto str=args->rgvarg[0].bstrVal;auto count=SysStringLen(str);if(count>262144)return E_INVALIDARG;std::string input;input.reserve(count);for(UINT i=0;i<count;i++){if(str[i]>127)return E_INVALIDARG;input.push_back(static_cast<char>(str[i]));}
      auto envelope=Json::parse(input);auto raw=unhex(envelope.at("requestHex"));verify(raw,unhex(envelope.at("opSignature")),false);verify(raw,unhex(envelope.at("uvSignature")),true);
      if(result){VariantInit(result);result->vt=VT_BOOL;result->boolVal=VARIANT_TRUE;}return S_OK;
    }catch(...){return E_ACCESSDENIED;}
  }
  ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}
  ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
  HRESULT STDMETHODCALLTYPE MakeCredential(PCWEBAUTHN_PLUGIN_OPERATION_REQUEST r,PWEBAUTHN_PLUGIN_OPERATION_RESPONSE s)override{return operation(r,s,true);}
  HRESULT STDMETHODCALLTYPE GetAssertion(PCWEBAUTHN_PLUGIN_OPERATION_REQUEST r,PWEBAUTHN_PLUGIN_OPERATION_RESPONSE s)override{return operation(r,s,false);}
  HRESULT STDMETHODCALLTYPE GetLockStatus(PLUGIN_LOCK_STATUS* state)override{if(!state)return E_POINTER;*state=PluginLocked;try{auto value=call_vault({{"kind","status"}});if(value.value("unlocked",false))*state=PluginUnlocked;}catch(...){}return S_OK;}
  HRESULT STDMETHODCALLTYPE CancelOperation(PCWEBAUTHN_PLUGIN_CANCEL_OPERATION_REQUEST request)override{try{if(!request)return E_INVALIDARG;auto raw=std::vector<BYTE>(reinterpret_cast<const BYTE*>(&request->transactionId),reinterpret_cast<const BYTE*>(&request->transactionId)+sizeof(GUID));verify(raw,unhex(hex(request->pbRequestSignature,request->cbRequestSignature)),false);{std::lock_guard<std::mutex> stateLock(stateMutex);if(request->transactionId!=transaction)return NTE_NOT_FOUND;cancelled=true;}return S_OK;}catch(...){return E_ACCESSDENIED;}}
};
class Factory final:public IClassFactory{
 std::atomic<ULONG> refs{1};
public:
 HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,void** out)override{if(!out)return E_POINTER;*out=nullptr;if(iid==IID_IUnknown||iid==IID_IClassFactory){*out=static_cast<IClassFactory*>(this);AddRef();return S_OK;}return E_NOINTERFACE;}
 ULONG STDMETHODCALLTYPE AddRef()override{return ++refs;}ULONG STDMETHODCALLTYPE Release()override{auto n=--refs;if(!n)delete this;return n;}
 HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer,REFIID iid,void** out)override{if(outer)return CLASS_E_NOAGGREGATION;auto object=new(std::nothrow) Authenticator;if(!object)return E_OUTOFMEMORY;auto hr=object->QueryInterface(iid,out);object->Release();return hr;}
 HRESULT STDMETHODCALLTYPE LockServer(BOOL)override{return S_OK;}
};
Json status(){UINT32 size=0;bool packaged=GetCurrentPackageFullName(&size,nullptr)==ERROR_INSUFFICIENT_BUFFER;AUTHENTICATOR_STATE state=AuthenticatorState_Disabled;auto hr=API(WebAuthNPluginGetAuthenticatorState)(PROVIDER,&state);return {{"available",true},{"packaged",packaged},{"registered",SUCCEEDED(hr)},{"enabled",SUCCEEDED(hr)&&state==AuthenticatorState_Enabled},{"packageRequired",hr==static_cast<HRESULT>(0x80073D54)}};}
void register_provider(){
  // FIDO 2.0/2.1, no unsupported extensions, resident credentials and UV.
  auto info=unhex("a50182684649444f5f325f30684649444f5f325f3103500000000000000000000000000000000004a462726bf5627570f5627576f564706c6174f5098168696e7465726e616c0a81a263616c672664747970656a7075626c69632d6b6579");
  WEBAUTHN_PLUGIN_ADD_AUTHENTICATOR_OPTIONS options{L"127Vaults",PROVIDER,L"127vaults.local",nullptr,nullptr,static_cast<DWORD>(info.size()),info.data(),0,nullptr};PWEBAUTHN_PLUGIN_ADD_AUTHENTICATOR_RESPONSE response=nullptr;
  check(API(WebAuthNPluginAddAuthenticator)(&options,&response));API(WebAuthNPluginFreeAddAuthenticatorResponse)(response);
}
int wmain(int argc,wchar_t** argv){
 try{
  webauthn=LoadLibraryExW(L"webauthn.dll",nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32);if(!webauthn)throw HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED);
  check(CoInitializeEx(nullptr,COINIT_MULTITHREADED));
  std::wstring mode=argc>1?argv[1]:L"--register";
  if(mode==L"--verify"){std::string data((std::istreambuf_iterator<char>(std::cin)),{});if(data.size()>262144)throw E_INVALIDARG;IDispatch* verifier=nullptr;check(CoCreateInstance(PROVIDER,nullptr,CLSCTX_LOCAL_SERVER,IID_IDispatch,reinterpret_cast<void**>(&verifier)));
    auto input=wide(data);VARIANT arg;VariantInit(&arg);arg.vt=VT_BSTR;arg.bstrVal=SysAllocStringLen(input.data(),static_cast<UINT>(input.size()));if(!arg.bstrVal){verifier->Release();throw E_OUTOFMEMORY;}DISPPARAMS args{&arg,nullptr,1,0};auto hr=verifier->Invoke(1,IID_NULL,LOCALE_USER_DEFAULT,DISPATCH_METHOD,&args,nullptr,nullptr,nullptr);VariantClear(&arg);verifier->Release();check(hr);return 0;}
  if(mode==L"--register"){if(!status().value("registered",false))register_provider();std::cout<<status().dump();if(argc==1){MessageBoxW(nullptr,L"127Vaults is registered. Enable it in Windows Settings > Accounts > Passkeys > Advanced options. Open and unlock 127Vaults Desktop before saving or using a passkey.",L"127Vaults native passkeys",MB_OK|MB_ICONINFORMATION);ShellExecuteW(nullptr,L"open",L"ms-settings:signinoptions-launchpasskeysettings",nullptr,nullptr,SW_SHOWNORMAL);}return 0;}
  if(mode==L"--sync-cache"){auto entries=call_vault({{"kind","cache"}}).at("entries");check(API(WebAuthNPluginAuthenticatorRemoveAllCredentials)(PROVIDER));for(auto& entry:entries)cache_credential(entry.at("metadata"));std::cout<<status().dump();return 0;}
  if(mode==L"--unregister"){check(API(WebAuthNPluginRemoveAuthenticator)(PROVIDER));auto path=std::wstring(L"Software\\Classes\\CLSID\\")+CLSID_TEXT;RegDeleteTreeW(HKEY_CURRENT_USER,path.c_str());std::cout<<status().dump();return 0;}
  if(mode==L"--settings"){ShellExecuteW(nullptr,L"open",L"ms-settings:signinoptions-launchpasskeysettings",nullptr,nullptr,SW_SHOWNORMAL);std::cout<<status().dump();return 0;}
  if(mode==L"--status"){std::cout<<status().dump();return 0;}
  if(mode!=L"--serve")throw E_INVALIDARG;
  check(CoInitializeSecurity(nullptr,-1,nullptr,nullptr,RPC_C_AUTHN_LEVEL_PKT_PRIVACY,RPC_C_IMP_LEVEL_IDENTIFY,nullptr,EOAC_DISABLE_AAA,nullptr));
  DWORD cookie=0;auto factory=new Factory;check(CoRegisterClassObject(PROVIDER,factory,CLSCTX_LOCAL_SERVER,REGCLS_MULTIPLEUSE,&cookie));factory->Release();
  MSG message;while(GetMessageW(&message,nullptr,0,0)>0){TranslateMessage(&message);DispatchMessageW(&message);}CoRevokeClassObject(cookie);return 0;
 }catch(HRESULT hr){std::cout<<Json({{"available",false},{"errorCode",static_cast<unsigned long>(hr)}}).dump();return 2;}catch(...){std::cout<<"{\"available\":false,\"error\":\"Native provider failed\"}";return 2;}
}

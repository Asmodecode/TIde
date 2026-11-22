import re

data = open('/Users/tenzinnagase/Downloads/TIde-main/emulator/firebird/dist/firebird.wasm', 'rb').read()
strs = re.findall(rb'[ -~]{3,}', data)
pat = re.compile(rb'^\.(tns|tno|tnc|tco|tcc|tmo|tmc|tct2|tlo|tco2|tcc2)$')
hits = sorted(set(s for s in strs if pat.match(s)))
print('extension-like strings in wasm:', hits)
kws = ["File is an OS", "Didn't get 04", "Send failed", "Send complete",
       "usblink connected", "endpoint not primed", "too big", "documents"]
for kw in kws:
    print(repr(kw), '->', kw.encode() in data)
for m in re.finditer(rb'\.tns', data):
    s = max(0, m.start() - 60)
    print('ctx:', data[s:m.end() + 20])

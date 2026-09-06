import subprocess, sys, os, shutil, struct
import pefile

exe = sys.argv[1]
ico = sys.argv[2]

shutil.copy2(exe, exe + '.bak')

with open(ico, 'rb') as f:
    ico_data = f.read()

num_icons = struct.unpack('<H', ico_data[4:6])[0]
print(f'ICO has {num_icons} icons')

icon_entries = []
base = 6
for i in range(num_icons):
    w = ico_data[base + i*16]
    h = ico_data[base + i*16 + 1]
    sz = struct.unpack('<I', ico_data[base + i*16 + 8:base + i*16 + 12])[0]
    off = struct.unpack('<I', ico_data[base + i*16 + 12:base + i*16 + 16])[0]
    icon_entries.append((w, h, sz, off))
    print(f'  Icon {i}: {w}x{h}, size={sz}, offset={off}')

group_data = struct.pack('<HHH', 0, 1, num_icons)
for w, h, sz, off in icon_entries:
    b1 = w if w < 256 else 0
    b2 = h if h < 256 else 0
    group_data += struct.pack('<BBBBHHII', b1, b2, 0, 0, 1, 32, sz, icon_entries.index((w, h, sz, off)) + 1)

all_icon_data = b''
for w, h, sz, off in icon_entries:
    all_icon_data += ico_data[off:off + sz]

new_res = group_data + all_icon_data
print(f'New resource size: {len(new_res)} bytes')

pe = pefile.PE(exe)
pe_bytes = bytearray(pe.__data__)

rsrc_dir = pe.DIRECTORY_ENTRY_RESOURCE
found = False
for entry in rsrc_dir.entries:
    if entry.id == 14:
        found = True
        for l1 in entry.directory.entries:
            for l2 in l1.directory.entries:
                data_rva = l2.data.struct.OffsetToData
                old_size = l2.data.struct.Size
                print(f'Group icon: rva={data_rva:#x}, old_size={old_size}, new_size={len(new_res)}')

                if len(new_res) <= old_size:
                    pe_bytes[data_rva:data_rva + len(new_res)] = new_res
                    l2.data.struct.Size = len(new_res)
                    print(f'Written at {data_rva:#x}')
                else:
                    print(f'Need more space: {old_size} -> {len(new_res)}, writing first {old_size} bytes')
                    pe_bytes[data_rva:data_rva + old_size] = new_res[:old_size]

                with open(exe, 'wb') as out:
                    out.write(pe_bytes)
                print('Done!')
                break
        break

if not found:
    print('No icon group found')

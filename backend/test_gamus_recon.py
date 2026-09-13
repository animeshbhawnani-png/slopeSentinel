import urllib.request
import json
import os

url = 'http://localhost:8000/api/terrain/reconstruct'
file_path = r'd:\SlopeSentinel\test_data\gamus\DC_03_26_RGB.png'

boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
with open(file_path, 'rb') as f:
    file_bytes = f.read()

body = bytearray()
body.extend(f'--{boundary}\r\n'.encode('utf-8'))
body.extend(b'Content-Disposition: form-data; name="file"; filename="DC_03_26_RGB.png"\r\n')
body.extend(b'Content-Type: image/png\r\n\r\n')
body.extend(file_bytes)
body.extend(b'\r\n')
body.extend(f'--{boundary}--\r\n'.encode('utf-8'))

req = urllib.request.Request(
    url,
    data=body,
    headers={'Content-Type': f'multipart/form-data; boundary={boundary}'}
)

try:
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        print('STATUS:', res.get('status'))
        print('CASE_ID:', res.get('case_id'))
        print('SOURCE_TYPE:', res.get('source_type'))
        print('MESH_OUTPUT:', res.get('mesh_output'))
        print('DSM_OUTPUT:', res.get('dsm_output'))
        print('DEPTH_OUTPUT:', res.get('depth_output'))
        print('MESH_STATS:', res.get('mesh_stats'))
        print('METRICS:', res.get('metadata', {}).get('metrics'))
        
        # Test fetching the mesh
        cid = res.get('case_id')
        mesh_req = urllib.request.Request(f'http://localhost:8000/api/terrain/reconstruct/{cid}/mesh')
        with urllib.request.urlopen(mesh_req) as mresp:
            mesh_data = mresp.read().decode('utf-8')
            lines = mesh_data.splitlines()
            v_lines = [l for l in lines if l.startswith('v ')]
            vn_lines = [l for l in lines if l.startswith('vn ')]
            vt_lines = [l for l in lines if l.startswith('vt ')]
            f_lines = [l for l in lines if l.startswith('f ')]
            print(f'MESH OBJ VERIFICATION: {len(v_lines)} vertices, {len(vn_lines)} normals, {len(vt_lines)} UVs, {len(f_lines)} faces')
            print('SAMPLE VERTEX:', v_lines[0] if v_lines else 'None')
            print('SAMPLE NORMAL:', vn_lines[0] if vn_lines else 'None')
            print('SAMPLE FACE:', f_lines[0] if f_lines else 'None')
except Exception as e:
    print('ERROR:', e)

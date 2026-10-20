"""Read only service state, public chain progress and filtered observer failures."""
import json
from pathlib import Path
import re
import runpy
import subprocess

ROOT = Path('/home/ubuntu/nostos/mainnet/observer')


def progress(text):
    text = re.sub(r'\x1b\[[0-9;]*m','',text)
    text = text.rsplit('Starting Zaino indexer',1)[-1]
    heights = re.findall(r'Syncing block height=(\d+)',text)
    tips = re.findall(r'chain_height=Height\((\d+)\)',text)
    times = re.findall(r'\d{4}-\d\d-\d\dT[\d:.]+Z',text)
    safe = runpy.run_path(str(Path(__file__).with_name('probe-observer-startup.py')))
    return dict(last_log_time=times[-1] if times else None,
        latest_indexed_height=int(heights[-1]) if heights else None,
        sampled_chain_height=int(tips[-1]) if tips else None,
        indexer_started='Started Zaino indexer' in text,
        filtered_errors=safe['safe_errors'](text))


def run():
    result = dict(read_only=True,sends_requested=0)
    state = subprocess.check_output(['systemctl','show','nostos-mainnet-observer.service',
        '--property=ActiveState','--property=SubState','--property=ExecMainStatus'],
        stderr=subprocess.PIPE,text=True,timeout=10)
    fields = dict(line.split('=',1) for line in state.splitlines() if '=' in line)
    result['service_active'] = fields.get('ActiveState')=='active'
    result['service_failed'] = fields.get('ActiveState')=='failed'
    code = fields.get('ExecMainStatus','')
    result['exit_status'] = int(code) if code.isdigit() else None
    path = ROOT/'service.log'
    with path.open('rb') as file:
        file.seek(max(0,path.stat().st_size-1048576))
        result.update(progress(file.read(1048576).decode(errors='replace')))
    if result['service_active']:
        try:
            helper = runpy.run_path(str(Path(__file__).with_name('configure-mainnet-preview.py')))
            status = helper['rpc'](38234,helper['protected'](ROOT/'.cookie'),'getwalletstatus',[])
            result.update(observer_rpc_passed=True,
                observer_node_height=(status.get('node_tip') or {}).get('height'),
                fully_synced_height=status.get('fully_synced_height'),sync_locked=status.get('locked'))
        except Exception as error:
            result.update(observer_rpc_passed=False,rpc_error_type=type(error).__name__)
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(run()))
    except Exception as error:
        print(json.dumps(dict(read_only=True,inspection_complete=False,
            error_type=type(error).__name__,sends_requested=0)))
        raise SystemExit(1) from None

import os
import subprocess
# insecure: shell=True with user input
def run(cmd):
    return os.system("rm -rf " + cmd)
def xss(req):
    return "<script> alert(" + req.params['q'] + ") </script>"

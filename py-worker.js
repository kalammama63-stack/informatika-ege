// Python в браузере: работает в отдельном потоке, чтобы бесконечный цикл
// не «вешал» страницу (основная страница просто перезапускает этот поток).
importScripts('pyodide/pyodide.js');

const HARNESS = `
import sys, io, builtins, traceback

_RU = {
    'NameError': 'Python не знает такого имени',
    'TypeError': 'Нельзя так смешивать разные типы данных',
    'ValueError': 'Не получилось превратить значение в число',
    'ZeroDivisionError': 'Деление на ноль',
    'IndexError': 'Обращение к элементу, которого нет',
    'KeyError': 'Такого ключа нет',
    'RecursionError': 'Функция вызывает сама себя слишком много раз',
}

def _line(e):
    if isinstance(e, SyntaxError):
        return e.lineno
    n = None
    for fr, ln in traceback.walk_tb(e.__traceback__):
        if fr.f_code.co_filename == 'program':
            n = ln
    return n

def _explain(e):
    name = type(e).__name__
    ln = _line(e)
    where = f' (строка {ln})' if ln else ''
    if isinstance(e, EOFError) and str(e) == 'NOINPUT':
        return 'Программа просит ввести данные (input), а в окошке «Ввод» больше ничего нет. Впиши туда значения, каждое с новой строки.'
    if isinstance(e, IndentationError):
        return f'Ошибка в отступах{where}. Строки внутри if, for, while и def сдвигаются на 4 пробела, остальные начинаются с края.'
    if isinstance(e, SyntaxError):
        return f'Ошибка в записи программы{where}. Проверь скобки, кавычки и двоеточие в конце строки с if / for / while.\\nPython пишет: {e.msg}'
    tip = ''
    if name == 'NameError':
        tip = '\\nПроверь, нет ли опечатки и создана ли эта переменная выше. Текст нужно брать в кавычки.'
    if name == 'TypeError' and ('str' in str(e) and 'int' in str(e)):
        tip = '\\nЧасто так бывает, если забыть int() вокруг input(): input() всегда даёт текст.'
    if name == 'ValueError' and 'int()' in str(e):
        tip = '\\nВ int() попал текст, который не является целым числом. Проверь, что ввёл.'
    ru = _RU.get(name, 'Ошибка')
    return f'{ru}{where}.{tip}\\nPython пишет: {name}: {e}'

def _run(code, stdin, echo):
    out = io.StringIO()
    lines = stdin.split('\\n') if stdin else []
    pos = [0]
    def inp(prompt=''):
        if echo:
            out.write(str(prompt))
        if pos[0] >= len(lines):
            raise EOFError('NOINPUT')
        v = lines[pos[0]]
        pos[0] += 1
        if echo:
            out.write(v + '\\n')
        return v
    old_out, old_in = sys.stdout, builtins.input
    sys.stdout, builtins.input = out, inp
    err = None
    try:
        exec(compile(code, 'program', 'exec'), {'__name__': '__main__'})
    except SystemExit:
        pass
    except BaseException as e:
        err = _explain(e)
    finally:
        sys.stdout, builtins.input = old_out, old_in
    text = out.getvalue()
    if len(text) > 20000:
        text = text[:20000] + '\\n… (вывод обрезан: слишком много строк)'
    return [text, err]
`;

const ready = (async () => {
  const py = await loadPyodide({ indexURL: new URL('pyodide/', self.location).href });
  py.runPython(HARNESS);
  return py;
})();

ready.then(() => postMessage({ type: 'ready' }), (e) => postMessage({ type: 'fail', error: String(e) }));

onmessage = async (ev) => {
  const { id, code, stdin, echo } = ev.data;
  const py = await ready;
  const res = py.globals.get('_run')(code, stdin || '', !!echo).toJs();
  postMessage({ type: 'result', id, out: res[0], err: res[1] || null });
};

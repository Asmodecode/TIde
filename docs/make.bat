@ECHO OFF
REM Builds TIde's docs with Sphinx on Windows: `make html`, then open _build\html\index.html.

pushd %~dp0

if "%SPHINXBUILD%" == "" (
	set SPHINXBUILD=sphinx-build
)
set SOURCEDIR=.
set BUILDDIR=_build
set SPHINXOPTS=-W --keep-going

%SPHINXBUILD% >NUL 2>NUL
if errorlevel 9009 (
	echo.
	echo.Sphinx isn't installed, or sphinx-build isn't on PATH. Install it with:
	echo.    pip install -r requirements.txt
	echo.
	exit /b 1
)

if "%1" == "" goto help

%SPHINXBUILD% -M %1 %SOURCEDIR% %BUILDDIR% %SPHINXOPTS% %O%
goto end

:help
%SPHINXBUILD% -M help %SOURCEDIR% %BUILDDIR% %SPHINXOPTS% %O%

:end
popd

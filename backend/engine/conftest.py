import os

# Tests import rasterio before backend.engine.main, so clear a system-wide PROJ override
# (e.g. PostGIS's older proj.db on Windows) here too; the wheels use their bundled PROJ data.
for _proj_key in ('PROJ_LIB', 'PROJ_DATA'):
    os.environ.pop(_proj_key, None)

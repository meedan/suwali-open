export type ConnectedFolder = {
  id: string;
  name: string;
  url: string;
};

export type PickerSettings = {
  api_key: string;
  app_id: string;
};

export type ImportResult = {
  copied: number;
  errors: string[];
};

export type PickedFile = {
  id: string;
  name: string;
};

// Mirrors the backend's extract_google_drive_folder_id
export const folderIdFromUrl = (url: string): string | null =>
  url.match(/(?:\/folders\/|open\?id=)([a-zA-Z0-9_-]+)/)?.[1] || null;

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const GAPI_SCRIPT_URL = "https://apis.google.com/js/api.js";

// Must stay in sync with the types the ingestion supports (FileConstraints /
// GOOGLE_WORKSPACE_EXPORT_MAP on the backend).
const IMPORTABLE_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.document",
].join(",");

type TokenClient = {
  requestAccessToken: () => void;
};

type TokenResponse = {
  access_token?: string;
  error?: string;
};

type PickerView = {
  setMimeTypes: (mimeTypes: string) => PickerView;
  setIncludeFolders: (include: boolean) => PickerView;
  setSelectFolderEnabled: (enabled: boolean) => PickerView;
  setEnableDrives: (enable: boolean) => PickerView;
  setParent: (parentId: string) => PickerView;
};

type Picker = {
  setVisible: (visible: boolean) => void;
};

type PickerCallbackData = {
  action: string;
  docs?: { id: string; name: string }[];
};

type PickerBuilder = {
  setAppId: (appId: string) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  addView: (view: PickerView) => PickerBuilder;
  enableFeature: (feature: string) => PickerBuilder;
  setMaxItems: (max: number) => PickerBuilder;
  setCallback: (callback: (data: PickerCallbackData) => void) => PickerBuilder;
  build: () => Picker;
};

type GoogleWindow = Window & {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (response: TokenResponse) => void;
          error_callback: (error: { type?: string; message?: string }) => void;
        }) => TokenClient;
      };
    };
    picker?: {
      PickerBuilder: new () => PickerBuilder;
      DocsView: new (viewId?: string) => PickerView;
      ViewId: { FOLDERS: string };
      Feature: { MULTISELECT_ENABLED: string };
      Action: { PICKED: string; CANCEL: string };
    };
  };
  gapi?: { load: (api: string, config: { callback: () => void; onerror: () => void }) => void };
};

const googleWindow = window as GoogleWindow;

const scriptPromises: Record<string, Promise<void>> = {};

const loadScript = (src: string): Promise<void> => {
  scriptPromises[src] ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      delete scriptPromises[src];
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
  return scriptPromises[src];
};

const loadGsiScript = (): Promise<void> => loadScript(GSI_SCRIPT_URL);

const loadPickerApi = async (): Promise<void> => {
  await loadScript(GAPI_SCRIPT_URL);
  if (googleWindow.google?.picker) return;
  await new Promise<void>((resolve, reject) => {
    googleWindow.gapi!.load("picker", {
      callback: () => resolve(),
      onerror: () => reject(new Error("Failed to load the Google Picker")),
    });
  });
};

// Resolves with null when the user closes the sign-in popup without granting access.
const requestAccessToken = (clientId: string): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const tokenClient = googleWindow.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.access_token) {
          resolve(response.access_token);
        } else {
          reject(new Error(response.error || "Google sign-in failed"));
        }
      },
      error_callback: (error) => {
        if (error.type === "popup_closed") {
          resolve(null);
        } else {
          reject(new Error(error.message || "Google sign-in failed"));
        }
      },
    });
    tokenClient.requestAccessToken();
  });

const driveGet = async (url: string, accessToken: string) => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Reading the folder failed (HTTP ${response.status})`);
  }
  return response.json();
};

const driveRequest = async (url: string, accessToken: string, body: object, failureMessage: string) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const responseBody = await response.json().catch(() => null);
    throw new Error(responseBody?.error?.message || `${failureMessage} (HTTP ${response.status})`);
  }
  return response.json();
};

const createFolder = (name: string, accessToken: string, parentId?: string): Promise<{ id: string; name: string }> =>
  driveRequest(
    "https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true",
    accessToken,
    { name: name, mimeType: FOLDER_MIME_TYPE, ...(parentId ? { parents: [parentId] } : {}) },
    "Creating the folder failed"
  );

// Sharing must happen while the folder is still empty: with the drive.file scope,
// Google rejects permission changes on folders containing files the app can't access.
const shareFolderWithServiceAccount = (folderId: string, shareEmail: string, accessToken: string): Promise<unknown> =>
  driveRequest(
    `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`,
    accessToken,
    { role: "reader", type: "user", emailAddress: shareEmail },
    "Sharing the folder failed"
  );

// Resolves with null when the user cancels the Picker without selecting files.
// Folders are not offered: picking one grants access to the folder object only,
// not its contents, so it could not be copied. File types are limited to what
// the ingestion supports.
const pickFiles = (settings: PickerSettings, accessToken: string, maxFiles: number): Promise<PickedFile[] | null> =>
  new Promise((resolve) => {
    const picker = googleWindow.google!.picker!;
    new picker.PickerBuilder()
      .setAppId(settings.app_id)
      .setOAuthToken(accessToken)
      .setDeveloperKey(settings.api_key)
      .addView(new picker.DocsView().setMimeTypes(IMPORTABLE_MIME_TYPES))
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setMaxItems(maxFiles)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          resolve(data.docs || []);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });

const copyFileToFolder = (fileId: string, name: string, folderId: string, accessToken: string): Promise<unknown> =>
  driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}/copy?supportsAllDrives=true`,
    accessToken,
    { name: name, parents: [folderId] },
    "Copying the file failed"
  );

// Reports which file is being copied; called with a null file name after the
// Picker closes but before the first copy (folder being prepared).
export type ImportProgressCallback = (fileName: string | null, index: number, total: number) => void;

const copyFiles = async (files: PickedFile[], folderId: string, accessToken: string, onProgress?: ImportProgressCallback): Promise<ImportResult> => {
  const result: ImportResult = { copied: 0, errors: [] };
  for (const [index, file] of files.entries()) {
    onProgress?.(file.name, index + 1, files.length);
    try {
      await copyFileToFolder(file.id, file.name, folderId, accessToken);
      result.copied += 1;
    } catch (error) {
      result.errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
};

// Google sign-in plus file selection. Nothing is written to the user's Drive
// here: picking only grants this app access to the selected files, so giving up
// afterwards leaves no trace. The returned token is what the later write steps
// need, and is only meant to be held in memory.
// Resolves with null when the user cancels the sign-in popup or the Picker.
export const pickDriveFiles = async (
  clientId: string,
  settings: PickerSettings,
  maxFiles: number
): Promise<{ files: PickedFile[]; accessToken: string } | null> => {
  await Promise.all([loadGsiScript(), loadPickerApi()]);

  const accessToken = await requestAccessToken(clientId);
  if (!accessToken) return null;

  const files = await pickFiles(settings, accessToken, maxFiles);
  if (!files) return null;

  return { files, accessToken };
};

// Picks the folder the connected folder will be created in, in My Drive or in a
// Shared Drive. Picking a folder grants this app the right to create files in
// it, which is all that is needed here — its existing contents stay private.
// Reuses the token from an earlier step so the user only signs in once.
// Resolves with null when the user cancels the sign-in popup or the Picker.
export const pickDriveParentFolder = async (
  clientId: string,
  settings: PickerSettings,
  existingAccessToken?: string | null
): Promise<{ folder: PickedFile; accessToken: string } | null> => {
  await Promise.all([loadGsiScript(), loadPickerApi()]);

  const accessToken = existingAccessToken || await requestAccessToken(clientId);
  if (!accessToken) return null;

  const folder = await new Promise<PickedFile | null>((resolve) => {
    const picker = googleWindow.google!.picker!;
    const foldersView = () => new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME_TYPE);
    new picker.PickerBuilder()
      .setAppId(settings.app_id)
      .setOAuthToken(accessToken)
      .setDeveloperKey(settings.api_key)
      // Two tabs: setEnableDrives shows shared drives *instead of* My Drive, so
      // a single view would leave users without shared drives staring at a blank page.
      .addView(foldersView().setParent("root"))
      .addView(foldersView().setEnableDrives(true))
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const picked = data.docs?.[0];
          resolve(picked ? { id: picked.id, name: picked.name } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
  if (!folder) return null;

  return { folder, accessToken };
};

// Creates the folder in the user's Drive, shares it read-only with the ingestion
// service account while it is still empty, and copies the picked files into it.
// The copies inherit that access, as does anything the user later adds to the
// folder. The copies are snapshots: later edits to the originals are not synced.
export const createFolderWithFiles = async (
  accessToken: string,
  shareEmail: string,
  folderName: string,
  files: PickedFile[],
  onProgress?: ImportProgressCallback,
  parentId?: string
): Promise<{ folder: ConnectedFolder; result: ImportResult }> => {
  onProgress?.(null, 0, files.length);

  const created = await createFolder(folderName, accessToken, parentId);
  await shareFolderWithServiceAccount(created.id, shareEmail, accessToken);
  const folder = { ...created, url: `https://drive.google.com/drive/folders/${created.id}` };

  return { folder, result: await copyFiles(files, folder.id, accessToken, onProgress) };
};

// Moves a folder this app created to another folder of the user's Drive. The
// folder keeps its id, so the source stays connected, and the service account
// keeps the access it was granted.
export const moveFolder = async (accessToken: string, folderId: string, parentId: string): Promise<void> => {
  const current = await driveGet(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=parents&supportsAllDrives=true`, accessToken);
  const removeParents = (current.parents || []).join(",");

  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?addParents=${parentId}` +
    `${removeParents ? `&removeParents=${removeParents}` : ""}&fields=id&supportsAllDrives=true`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Moving the folder failed (HTTP ${response.status})`);
  }
};

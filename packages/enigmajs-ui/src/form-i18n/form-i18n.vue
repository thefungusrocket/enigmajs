<template lang="pug">
eg-promise-section(
  v-model="response",
  :loading-height="loadingHeight",
  @ok="onOk",
  source="/languages"
)
  el-tabs.eg-i18n-form(
    ref="elTabs",
    v-model="currentTab",
    :class="{ 'is-all-auto': isAllAuto }",
    type="card"
  )
    el-tab-pane.pa-4(v-for="item in internal", :name="item.lang.code")
      template(v-slot:label)
        .eg-i18n-form__tab-item(
          :class="{ 'is-auto': item.isAuto, 'is-default': item.isDefault }"
        )
          span.mr-2 {{ t(`lang.${item.lang.code}`) }}
          el-switch(
            v-if="item.isDefault",
            v-model="item.isAuto",
            :disabled="item.isLoading",
            @change="onChangeDefault",
            @click.stop
          )
          el-switch(
            v-else,
            v-model="item.isAuto",
            :disabled="item.isLoading || isAllAuto",
            @click.stop
          )

      template(v-slot:default)
        .eg-i18n-form__content(
          :class="{ 'is-auto': item.isAuto, 'is-default': item.isDefault }"
        )
          .content-header
            span
              el-popover(
                :placement="xs ? 'bottom' : 'left'",
                :title="item.isDefault ? t('eg.i18n_form.translate_all_auto') : t('eg.i18n_form.translate_auto')",
                :width="xs ? 300 : 350",
                popper-class="eg-i18n-form",
                trigger="click"
              )
                template(v-slot:reference)
                  i.el-icon-info.mr-2.info

                template(v-if="item.isDefault")
                  i18n-t(
                    keypath="eg.i18n_form.popover_content_def",
                    scope="global",
                    tag="div"
                  )
                    b.text-all-auto {{ t('eg.i18n_form.this_lang') }}
                    b.text-primary {{ t('eg.i18n_form.other_lang') }}
                  br
                  b.text-all-auto {{ t('lang.default_lang') }}
                template(v-else)
                  i18n-t(
                    keypath="eg.i18n_form.popover_content",
                    scope="global",
                    tag="div"
                  )
                    b.text-all-auto {{ tl(`lang.${defaultLang}`) }}
                    b.text-primary {{ tl(`lang.${item.lang.code}`) }}
                  br

                i18n-t(
                  v-if="isAllAuto",
                  :class="['text-all-auto']",
                  keypath="eg.i18n_form.popover_is_all_auto",
                  scope="global",
                  tag="div"
                )
                  b {{ t('eg.i18n_form.translate_all_auto') }}
                i18n-t(
                  v-else-if="item.isAuto",
                  :class="['text-primary']",
                  keypath="eg.i18n_form.popover_is_all_auto",
                  scope="global",
                  tag="div"
                )
                  b {{ t('eg.i18n_form.translate', { lang: tl(`lang.${defaultCode}`) }) }}
                div(v-else) {{ t('eg.i18n_form.translate_deactivated') }}

              b.lang-name {{ t(`lang.${item.lang.code}`) }}
              span.def-lang.ml-2(v-if="item.isDefault") ({{ t('lang.default_lang') }})

            span.lang-pre {{ t('eg.i18n_form.form_header') }}
              b.lang-id {{ item.lang.id }}
          el-divider.my-2
          el-form(
            :label-width="labelWidth",
            :model="item.target",
            :ref=`
                // @ts-ignore 
                (el) => (forms[item.lang.code] = el)
              `,
            :rules="rules"
          )
            template(v-for="(tVal, tKey) in item.target")
              el-form-item(
                v-if="isString(tVal)",
                :label="t(`${i18nPrefix}.${String(tKey)}`)",
                :prop="tKey"
              )
                el-input(
                  v-if="!item.isDefault && (isAllAuto || item.isAuto)",
                  v-model="item.target[tKey]",
                  :placeholder="makePlaceholder(String(tKey))",
                  disabled
                )
                el-input(v-else, v-model="item.target[tKey]")
          .text-center(v-if="item.isAuto && !item.isDefault")
            el-button(
              :loading="item.isLoading",
              @click="translate([item.lang.code])"
            ) {{ t('eg.i18n_form.translate_now') }}
</template>

<script lang="ts">
import {
  PropType,
  defineComponent,
  inject,
  reactive,
  ref,
  watchEffect,
  computed,
} from "vue";

import { Paginator, Ok } from "enigmajs-core";
import { ElMessage } from "element-plus";
import { useI18n } from "../plugins/i18n";
import {
  clone,
  forOwn,
  isEmpty,
  isString,
  mergeWith,
  omit,
  pick,
  pickBy,
} from "lodash";

import { useAxios } from "../plugins/axios";

import { IClearValidate, IForm, IFormI18n, IValidate, IValidateField } from ".";
import { IFORM_KEY, Rules } from "..";
import { useViewport } from "../viewport";

import {
  I18nFormItem,
  I18nRequest,
  I18nResponse,
  Lang,
  Target,
} from "../types";

type Internal = Record<string, I18nFormItem>;
type Forms = Record<string, IForm>;

const autoIfUpdateKey = "eg-for-i18n.auto_if_update";

export default defineComponent({
  name: "EgFormI18n",
  props: {
    loadingHeight: { type: [String, Number], default: 350 },
    labelWidth: { type: [String, Number], default: "100px" },
    defaultLang: { type: String, default: "es" },
    i18nPrefix: { type: String, default: "cmn" },

    fields: { type: Array as PropType<string[]>, default: undefined },
    target: { type: Object as PropType<Target>, default: undefined },
    items: { type: Array as PropType<Target[]>, default: undefined },

    rules: { type: Object as PropType<Rules>, default: undefined },
    langProp: { type: String, default: "lang" },
    idProp: { type: String, default: "id" },
  },
  emits: ["load", "translating"],
  setup(props, { emit, expose }) {
    const axios = useAxios();
    const { t, messages } = useI18n();
    const { xs } = useViewport();

    const form = inject(IFORM_KEY, undefined);
    const forms = reactive<Forms>({});

    const response = ref(undefined);
    const internal = reactive<Internal>({});
    const currentTab = ref(props.defaultLang);

    const isAllAuto = ref(true);

    watchEffect(() => {
      const _default = internal[props.defaultLang];
      isAllAuto.value = _default ? _default.isAuto : false;
    });

    /**
     *
     */
    function initItem(): [Target, string[]] {
      const fields = props.fields
        ? props.fields
        : props.target
        ? Object.keys(props.target)
        : ["name"];

      return [Object.fromEntries(fields.map((e) => [e, ""])), fields];
    }

    /**
     *
     */
    function initTarget(id: number): [Target, string[]] {
      const [target, fields] = initItem();
      target[props.langProp] = id;
      return [target, fields];
    }

    /**
     *
     */
    function onChangeDefault(val: boolean) {
      localStorage.setItem(autoIfUpdateKey, String(val));

      if (val) {
        forOwn(internal, (value) => {
          value.isAuto = true;
        });
      }
    }

    /**
     *
     */
    function onOk({ payload }: Ok<Paginator<Lang>>) {
      const defLang = payload.results.find((e) => e.code === props.defaultLang);

      if (defLang) {
        const _target = props.target;
        if (_target) {
          omit(_target);
          const [newTarget, fields] = initTarget(defLang.id);

          const cloned = clone(_target);
          for (const key in cloned) {
            if (![props.langProp, props.idProp, ...fields].includes(key)) {
              delete _target[key];
            }
          }

          mergeWith(_target, newTarget, (objVal, srcVal, key) =>
            key === props.langProp ? srcVal : objVal
          );
        }

        const _items = props.items;
        if (_items) {
          for (const { id, code } of payload.results) {
            if (!_target || code !== defLang.code) {
              const [newTarget, fields] = initTarget(id);

              const idx = _items.findIndex((e) => e[props.langProp] === id);
              if (idx >= 0) {
                const itemTarget = _items[idx];

                const cloned = clone(itemTarget);
                for (const key in cloned) {
                  if (
                    ![props.langProp, props.idProp, ...fields].includes(key)
                  ) {
                    delete itemTarget[key];
                  }
                }

                mergeWith(_items[idx], newTarget, (objVal, srcVal, key) =>
                  key === props.langProp ? srcVal : objVal
                );
              } else {
                _items.push(newTarget);
              }
            }
          }
        }

        const allAutoConf = localStorage.getItem(autoIfUpdateKey) ?? "true";
        const allAuto = allAutoConf === "true";

        for (const lang of payload.results) {
          const isDefault = lang.code === props.defaultLang;

          let target: Target;

          if (isDefault && _target) {
            target = _target;
          } else if (_items) {
            const item = _items.find((e) => e[props.langProp] === lang.id);
            if (item === undefined) {
              throw new Error(
                `A form i18n item with lang prop ${props.langProp} was not found`
              );
            }
            target = item;
          } else {
            [target] = initItem();
          }

          internal[lang.code] = {
            isAuto: allAuto,
            isDefault: isDefault,
            isLoading: false,
            lang: lang,
            target: target,
          };
        }
      } else {
        ElMessage({
          type: "error",
          showClose: true,
          message: t("eg.i18n_form.no_def"),
        });
      }

      emit("load", payload);
    }

    /**
     *
     */
    async function translate(langs: string[]): Promise<boolean> {
      if (langs.length < 1) {
        return false;
      }

      emit("translating", true);

      const fromSource = pickBy(
        internal[props.defaultLang].target,
        (val) => typeof val === "string" && val
      ) as Record<string, string>;

      if (isEmpty(fromSource)) {
        emit("translating", false);
        ElMessage({
          type: "warning",
          showClose: true,
          message: t("eg.i18n_form.empty_translation"),
        });
        return false;
      }

      const toItems = langs.map((e) => {
        const i18nItem = internal[e];
        i18nItem.isLoading = true;
        return i18nItem;
      });

      if (toItems.length < 1) {
        emit("translating", false);
        return false;
      }

      internal[props.defaultLang].isLoading = true;

      const requestBody: I18nRequest = {
        text: Object.values(fromSource),
        from_lang: props.defaultLang,
        to_lang: langs,
      };

      const response = await axios.buildResponse<I18nResponse>({
        notify: false,
        request: {
          method: "POST",
          url: "/translations/",
          data: requestBody,
        },
        ifOk: ({ payload }) => {
          const sourceKeys = Object.keys(fromSource);

          payload.forEach(({ translations }, idx) => {
            const propKey = sourceKeys[idx];

            translations.forEach(({ text }, idx0) => {
              toItems[idx0].target[propKey] = text;
            });
          });

          ElMessage({
            type: "success",
            showClose: true,
            message: t("eg.i18n_form.translation_success"),
          });
        },
        ifErr: () => {
          ElMessage({
            type: "error",
            showClose: true,
            message: t("eg.i18n_form.translation_error"),
          });
        },
        finally: () => {
          internal[props.defaultLang].isLoading = false;
          for (const item of toItems) {
            item.isLoading = false;
          }

          emit("translating", false);
        },
      });

      return response.isOk;
    }

    /**
     *
     */
    function formValidate(form: IForm): Promise<boolean> {
      return new Promise((resolve) => {
        form.validate((valid) => resolve(valid === true));
      });
    }

    /**
     *
     */
    function validateField(opts: IValidateField) {
      for (const item of Object.values(forms)) {
        item.validateField(opts.props, opts.callback);
      }

      if (!opts.omitInner && form?.value) {
        form.value.validateField(opts.props, opts.callback);
      }
    }

    /**
     *
     */
    function resetFields(omitInner = false): void {
      for (const item of Object.values(forms)) {
        item.resetFields();
      }

      if (!omitInner && form?.value) {
        form.value.resetFields();
      }
    }

    /**
     *
     */
    function clearValidate(opts: IClearValidate = {}): void {
      for (const item of Object.values(forms)) {
        item.clearValidate(opts.props);
      }

      if (!opts.omitInner && form?.value) {
        form.value.clearValidate(opts.props);
      }
    }

    /**
     *
     */
    async function validate(opts: IValidate = {}): Promise<boolean> {
      const selected = pick(
        forms,
        opts.langs ?? isAllAuto.value
          ? props.defaultLang
          : Object.keys(pickBy(internal, (val) => !val.isAuto))
      );

      const promises = Object.values(selected).map((el) => formValidate(el));

      if (!opts.omitInner && form) {
        promises.push(formValidate(form.value));
      }

      const results = await Promise.all(promises);
      return results.every((e) => e === true);
    }

    /**
     *
     */
    async function execute(): Promise<boolean> {
      const promises: Promise<boolean>[] = [validate()];

      if (form) {
        promises.push(formValidate(form.value));
      }

      const results = await Promise.allSettled(promises);
      let isValid = results.every((e) =>
        e.status === "fulfilled" ? e.value === true : false
      );

      if (isValid) {
        const targets = pickBy(
          omit(internal, props.defaultLang),
          (val: I18nFormItem) => val.isAuto
        );

        if (!isEmpty(targets)) {
          const langs = Object.keys(targets);
          isValid = await translate(langs);
        }
      } else {
        let message = "";

        if (results.length === 2) {
          if (!results[0] && !results[1]) {
            message = t("eg.i18n_form.both_validation_error");
          }
        }

        if (results.length === 1) {
          message = t("eg.i18n_form.validation_error");
        } else {
          if (!results[0] && !results[1]) {
            message = t("eg.i18n_form.both_validation_error");
          } else {
            if (!results[0]) {
              message = t("eg.i18n_form.validation_error");
            } else {
              message = t("app.form_error");
            }
          }
        }

        ElMessage({
          type: "error",
          showClose: true,
          message: message,
        });
      }

      return isValid;
    }

    /**
     *
     */
    function makePlaceholder(key: string): string {
      return internal[props.defaultLang].target[key]
        ? t("eg.i18n_form.to_translate", {
            val: internal[props.defaultLang].target[key],
          })
        : t("eg.i18n_form.wait_default", {
            def: t(`lang.${props.defaultLang}`).toLowerCase(),
          });
    }

    function uncheckAll() {
      for (const key in internal) {
        internal[key].isAuto = false;
      }
    }

    const exports: IFormI18n = {
      clearValidate,
      execute,
      resetFields,
      translate,
      uncheckAll,
      validate,
      validateField,
    };

    expose(exports);

    return {
      currentTab,
      emit,
      forms,
      internal,
      isAllAuto,
      isString,
      xs,
      makePlaceholder,
      messages,
      onChangeDefault,
      onOk,
      response,
      t,
      translate,

      defaultCode: computed(() => internal[props.defaultLang]?.lang.code),
      tl: (input: string) => t(input).toLocaleLowerCase(),
    };
  },
});
</script>
